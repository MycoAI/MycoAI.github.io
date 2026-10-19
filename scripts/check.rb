# Safety check for the redesign: the new build must keep every legacy URL and
# render exactly the same visible content as the legacy site.
#
# Usage (from the repository root):
#   bundle exec ruby scripts/check.rb               # build both sites, then compare
#   bundle exec ruby scripts/check.rb --no-build    # compare the previous builds again
#   bundle exec ruby scripts/check.rb --ref <git-ref>   # compare against another ref
#
# Builds go to _private/check/{legacy,current}; for each page with differences
# the extracted old/new text is written to _private/check/diff/.
#
# Elements marked with a `data-added` attribute are new (approved separately, see
# _private/new-text.md). They are taken out before old and new are compared, and their
# text is listed in _private/check/added.txt.
#
# The 3D hero check needs Node 22+ and Chrome (scripts/hero3d-check.mjs); without them it is
# reported as skipped, with a warning.

require "fileutils"
require "json"
require "socket"
require "webrick"
require "open3"
require "optparse"
require "rbconfig"
require "tmpdir"
require "yaml"
require "nokogiri"

ROOT = File.expand_path("..", __dir__)
OUT = File.join(ROOT, "_private", "check")
LEGACY_DIR = File.join(OUT, "legacy")
CURRENT_DIR = File.join(OUT, "current")
DIFF_DIR = File.join(OUT, "diff")
ADDED_FILE = File.join(OUT, "added.txt")
SITE_ORIGIN = %r{\Ahttps?://mycoai\.github\.io}i

# Local-only files (see .git/info/exclude) are left out of the working-tree build.
LOCAL_ONLY = %w[CLAUDE.md .claude _private].freeze

# Theme files may be replaced by the redesign; a missing one is only a warning.
OPTIONAL_PREFIXES = ["assets/"].freeze

# Header and footer labels changed on request (see _private/new-text.md):
# [legacy label, link] => new label. Any other label change fails the check.
# Header links must keep their order; footer links must all still be there (the footer
# groups them differently).
APPROVED_RELABELS = {
  ["MycoAI's website", "/"] => "MycoAI",
  ["Projects", "https://github.com/MycoAI"] => "GitHub",
  ["Mail", "mailto:d.vu@wi.knaw.nl"] => "d.vu@wi.knaw.nl",
  ["WI", "https://wi.knaw.nl/"] => "Westerdijk Institute",
  ["Github", "https://github.com/MycoAI"] => "MycoAI on GitHub",
}.freeze

BLOCK_TAGS = %w[
  address article aside blockquote br caption dd details dialog div dl dt
  fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main
  nav ol p pre section summary table tbody td tfoot th thead tr ul
].freeze
INVISIBLE_TAGS = %w[script style noscript template head title].freeze
CHROME_TAGS = %w[header footer nav aside].freeze

options = { build: true, ref: "legacy-jekyll" }
OptionParser.new do |o|
  o.on("--no-build", "Reuse the builds from the previous run") { options[:build] = false }
  o.on("--ref REF", "Git ref of the reference site (default: legacy-jekyll)") { |r| options[:ref] = r }
end.parse!

$failures = 0
$warnings = 0

def fail!(msg)
  $failures += 1
  puts "  FAIL  #{msg}"
end

def warn!(msg)
  $warnings += 1
  puts "  WARN  #{msg}"
end

def run!(*cmd, chdir: ROOT)
  out, status = Open3.capture2e(*cmd, chdir: chdir)
  return out if status.success?

  puts out
  abort "Command failed: #{cmd.join(' ')}"
end

def jekyll_build(source, dest, extra_config: nil)
  FileUtils.rm_rf(dest)
  env = { "JEKYLL_ENV" => "development", "PAGES_REPO_NWO" => "MycoAI/MycoAI.github.io" }
  jekyll = Gem.bin_path("jekyll", "jekyll")
  config = ["_config.yml", extra_config].compact.join(",")
  out, status = Open3.capture2e(env, RbConfig.ruby, jekyll, "build", "--source", source,
                                "--destination", dest, "--config", config, chdir: source)
  return if status.success?

  puts out
  abort "Jekyll build failed for #{source}"
end

def build_sites(ref)
  puts "Building #{ref} -> #{LEGACY_DIR}"
  Dir.mktmpdir("mycoai-legacy") do |tmp|
    tree = File.join(tmp, "src")
    run!("git", "worktree", "add", "--detach", "--quiet", tree, ref)
    begin
      jekyll_build(tree, LEGACY_DIR)
    ensure
      run!("git", "worktree", "remove", "--force", tree)
    end
  end
  puts "Building working tree -> #{CURRENT_DIR}"
  Dir.mktmpdir("mycoai-config") do |tmp|
    exclude = Array(YAML.load_file(File.join(ROOT, "_config.yml"))["exclude"]) + LOCAL_ONLY
    overlay = File.join(tmp, "local.yml")
    File.write(overlay, { "exclude" => exclude }.to_yaml)
    jekyll_build(ROOT, CURRENT_DIR, extra_config: overlay)
  end
end

def site_files(dir)
  Dir.glob("**/*", File::FNM_DOTMATCH, base: dir)
     .select { |f| File.file?(File.join(dir, f)) }
     .sort
end

def url_for(path)
  path.end_with?("index.html") ? "/#{path.delete_suffix('index.html')}" : "/#{path}"
end

def page?(path)
  path.end_with?(".html") && OPTIONAL_PREFIXES.none? { |p| path.start_with?(p) }
end

# ---------- text extraction ----------

def normalise(text)
  text.gsub(/[[:space:]]+/, " ").strip
end

# Text of a node with a break at every block boundary; returns one string per block.
def text_blocks(node, link_breaks: false)
  blocks = [+""]
  walk = lambda do |n|
    if n.text?
      blocks.last << n.text
    elsif n.element?
      name = n.name.downcase
      return if INVISIBLE_TAGS.include?(name) || name == "svg"

      brk = BLOCK_TAGS.include?(name) || (link_breaks && name == "a")
      blocks << +"" if brk
      n.children.each { |c| walk.call(c) }
      blocks << +"" if brk
    end
  end
  walk.call(node)
  blocks.map { |b| normalise(b) }.reject(&:empty?)
end

def content_root(doc)
  main = doc.at_css("main")
  return main.dup if main

  body = doc.at_css("body").dup
  body.element_children.each { |c| c.remove if CHROME_TAGS.include?(c.name.downcase) }
  body
end

def chrome_root(doc)
  body = doc.at_css("body").dup
  main = body.at_css("main")
  if main
    main.remove
  else
    body.element_children.each { |c| c.remove unless CHROME_TAGS.include?(c.name.downcase) }
  end
  body
end

def normalise_href(href, page_url)
  return "" if href.nil?

  href = href.strip.sub(SITE_ORIGIN, "")
  return href if href.empty? || href.match?(/\A[a-z][a-z0-9+.-]*:/i) || href.start_with?("/", "#")

  # resolve page-relative links against the page URL
  base = page_url.end_with?("/") ? page_url : File.dirname(page_url) + "/"
  File.expand_path(href, base).sub(/\A[A-Za-z]:/, "")
end

def accessible_name(a)
  name = normalise(text_blocks(a).join(" "))
  name = a["aria-label"].to_s if name.empty?
  name = a.at_css("[aria-label]")&.[]("aria-label").to_s if name.empty?
  name = a.at_css("img[alt]")&.[]("alt").to_s if name.empty?
  normalise(name)
end

def extract(path, url)
  doc = Nokogiri::HTML5(File.read(path, encoding: "UTF-8"))
  added = doc.css("[data-added]").map { |e| normalise(text_blocks(e).join(" ")) }.reject(&:empty?)
  doc.css("[data-added]").each(&:remove)
  content = content_root(doc)
  chrome = chrome_root(doc)
  chrome_links = chrome.css("a[href]").map { |a| [accessible_name(a), normalise_href(a["href"], url)] }
  in_footer = chrome.css("a[href]").map { |a| a.ancestors.any? { |p| p.name == "footer" } }
  {
    title: normalise(doc.at_css("title")&.text.to_s),
    text: normalise(text_blocks(content).join(" ")),
    blocks: text_blocks(content),
    links: content.css("a[href]").map { |a| normalise_href(a["href"], url) },
    images: content.css("img").map { |i| normalise_href(i["src"], url) },
    ids: content.css("[id]").map { |e| e["id"] },
    chrome_links: chrome_links,
    header_links: chrome_links.reject.with_index { |_, i| in_footer[i] },
    footer_links: chrome_links.select.with_index { |_, i| in_footer[i] },
    chrome_text: text_blocks(chrome, link_breaks: true) - chrome_links.map(&:first),
    chrome_all: normalise(text_blocks(chrome, link_breaks: true).join(" ")),
    added: added,
  }
end

def first_difference(a, b)
  i = 0
  i += 1 while i < a.length && i < b.length && a[i] == b[i]
  from = [i - 60, 0].max
  ["...#{a[from, 140]}...", "...#{b[from, 140]}..."]
end

def subsequence?(small, big)
  j = 0
  big.each { |x| j += 1 if j < small.length && x == small[j] }
  j == small.length
end

def list_diff(label, old, new)
  return if old == new

  missing = old - new
  added = new - old
  msg = "#{label} differ"
  msg += "; missing: #{missing.inspect}" unless missing.empty?
  msg += "; added: #{added.inspect}" unless added.empty?
  msg += "; order changed" if missing.empty? && added.empty?
  fail!(msg)
end

# ---------- checks ----------

build_sites(options[:ref]) if options[:build]
abort "No builds found in #{OUT}; run without --no-build" unless Dir.exist?(LEGACY_DIR) && Dir.exist?(CURRENT_DIR)

legacy_files = site_files(LEGACY_DIR)
current_files = site_files(CURRENT_DIR)

puts "\n== URL check (#{legacy_files.size} legacy files)"
legacy_files.each do |f|
  next if current_files.include?(f)

  if OPTIONAL_PREFIXES.any? { |p| f.start_with?(p) }
    warn!("theme file no longer exists: #{url_for(f)}")
  else
    fail!("missing URL: #{url_for(f)}")
  end
end
(current_files - legacy_files).select { |f| page?(f) }.each do |f|
  warn!("new page not on the legacy site: #{url_for(f)}")
end

puts "\n== Internal link check"
current_files.select { |f| f.end_with?(".html") && !f.start_with?("assets/") }.each do |f|
  doc = Nokogiri::HTML5(File.read(File.join(CURRENT_DIR, f), encoding: "UTF-8"))
  doc.css("a[href], img[src]").each do |el|
    ref = (el["href"] || el["src"]).sub(SITE_ORIGIN, "")
    next unless ref.start_with?("/") && !ref.start_with?("//")

    path = ref.split(/[?#]/).first.to_s.sub(%r{\A/}, "")
    ok = path.empty? || current_files.include?(path) || current_files.include?(File.join(path, "index.html"))
    fail!("#{url_for(f)}: broken internal link #{ref}") unless ok
  end
end

pages = legacy_files.select { |f| page?(f) && current_files.include?(f) }
added_report = []
puts "\n== Approved header/footer relabels"
APPROVED_RELABELS.each { |(old, href), new| puts "  info  #{old.inspect} -> #{new.inspect} (#{href})" }
puts "\n== Content check (#{pages.size} pages)"
FileUtils.rm_rf(DIFF_DIR)
pages.each do |f|
  url = url_for(f)
  old = extract(File.join(LEGACY_DIR, f), url)
  new = extract(File.join(CURRENT_DIR, f), url)
  before = $failures

  fail!("#{url}: <title> differs: #{old[:title].inspect} -> #{new[:title].inspect}") if old[:title] != new[:title]

  if old[:text] != new[:text]
    o, n = first_difference(old[:text], new[:text])
    fail!("#{url}: visible text differs\n        old: #{o}\n        new: #{n}")
    FileUtils.mkdir_p(DIFF_DIR)
    stem = f.tr("/", "_").delete_suffix(".html")
    File.write(File.join(DIFF_DIR, "#{stem}.old.txt"), old[:blocks].join("\n") + "\n")
    File.write(File.join(DIFF_DIR, "#{stem}.new.txt"), new[:blocks].join("\n") + "\n")
  end

  list_diff("#{url}: content links", old[:links], new[:links])
  list_diff("#{url}: content images", old[:images], new[:images])

  missing_ids = old[:ids] - new[:ids]
  fail!("#{url}: anchors missing: #{missing_ids.inspect}") unless missing_ids.empty?

  relabel = ->(links) { links.map { |name, href| [APPROVED_RELABELS.fetch([name, href], name), href] } }
  old[:chrome_links] = relabel.call(old[:chrome_links])
  old_header = relabel.call(old[:header_links])
  unless subsequence?(old_header, new[:header_links])
    fail!("#{url}: menu links changed\n        old: #{old_header.inspect}\n        new: #{new[:header_links].inspect}")
  end
  missing_footer = relabel.call(old[:footer_links]) - new[:footer_links]
  fail!("#{url}: footer links missing: #{missing_footer.inspect}") unless missing_footer.empty?
  extra = new[:chrome_links] - old[:chrome_links]
  warn!("#{url}: new menu/footer links: #{extra.inspect}") unless extra.empty?

  old[:chrome_text].each do |t|
    fail!("#{url}: header/footer text missing: #{t.inspect}") unless new[:chrome_all].include?(t)
  end

  added_report << "#{url}\n" + new[:added].map { |t| "    #{t}" }.join("\n") unless new[:added].empty?
  note = new[:added].empty? ? "" : " (#{new[:added].size} added block(s) excluded)"
  puts "  ok    #{url}#{note}" if $failures == before
end
File.write(ADDED_FILE, added_report.join("\n\n") + "\n")
puts "\nAdded text per page: #{ADDED_FILE}"

puts "\n== 3D hero (home page)"
HERO_SCRIPTS = %w[assets/js/vendor/three.min.js assets/js/vendor/OrbitControls.js assets/js/hero3d.js].freeze
HERO_SCRIPTS.each { |f| fail!("missing in the build: /#{f}") unless current_files.include?(f) }
home = Nokogiri::HTML5(File.read(File.join(CURRENT_DIR, "index.html"), encoding: "UTF-8"))
srcs = home.css("script[src]").map { |s| [s["src"].sub(%r{\A/}, ""), s.key?("defer")] }
order = HERO_SCRIPTS.map { |f| srcs.index { |src, _| src == f } }
if order.any?(&:nil?)
  fail!("home page does not load #{HERO_SCRIPTS.reject.with_index { |_, i| order[i] }.join(', ')}")
elsif order != order.sort
  fail!("home page loads the 3D scripts in the wrong order (needs three -> OrbitControls -> hero3d)")
elsif order.any? { |i| !srcs[i][1] }
  fail!("home page loads the 3D scripts without defer")
end
fail!("home page has no #stage") unless home.at_css("#stage")

node_ok = system("node", "--version", out: File::NULL, err: File::NULL)
if !node_ok
  warn!("headless 3D check skipped: Node is not installed")
else
  port = TCPServer.open("127.0.0.1", 0) { |s| s.addr[1] }
  server = WEBrick::HTTPServer.new(Port: port, BindAddress: "127.0.0.1", DocumentRoot: CURRENT_DIR,
                                   Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
  thread = Thread.new { server.start }
  out, status = Open3.capture2(*["node", File.join(ROOT, "scripts", "hero3d-check.mjs"), "http://127.0.0.1:#{port}/"])
  server.shutdown
  thread.join
  report = JSON.parse(out) rescue nil
  if report.nil?
    warn!("headless 3D check could not run (is Chrome installed?): #{out.strip[0, 200]}")
  else
    report["results"].each do |r|
      label = "#{r['width']}px#{r['flags'].to_a.empty? ? '' : " #{r['flags'].join(' ')}"}"
      if r["error"]
        fail!("3D hero at #{label}: #{r['error']}")
        next
      end
      c = r.dig("probe", "canvas")
      if c && c["visible"] && c["width"].to_i > 0 && c["height"].to_i > 0
        puts "  ok    #{label}: canvas #{c['width']}x#{c['height']} in #stage"
      else
        fail!("3D hero at #{label}: no visible canvas in #stage (#{r['probe'].inspect})")
      end
      r["errors"].each { |e| fail!("3D hero at #{label}: console error: #{e}") }
      r["failed"].each { |e| fail!("3D hero at #{label}: failed request: #{e}") }
    end
    fail!("headless 3D check failed") if !status.success? && $failures.zero?
  end
end

puts "\n#{$failures} failure(s), #{$warnings} warning(s)"
exit($failures.zero? ? 0 : 1)
