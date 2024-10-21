---
title:  "Applying the deep learning approach for fungal classification"
layout: post
categories: media
---
I am very happy to share with you the excellent news that our paper titled [Convolutional Neural Networks Improve Fungal Classification](https://www.nature.com/articles/s41598-020-69245-y) has been made publicly available.

This is the first time we have applied the deep learning approach with two models: Convolutional Neural Network (CNN) and a Deep Belief Network (DBN) for fungal classification. We have compared the results with traditional methods such as BLAST classification and the most accurate machine learning-based Ribosomal Database Project (RDP). Our findings show that the deep learning approach outperformed the traditional methods in cases where we had enough reference sequences in the training dataset. However, when classifying a dataset that is not present in the training dataset, BLAST could reveal the most sequences. The source code of the CNN and DBN classifiers as well as the comparion can be found at my github page: [https://github.com/vuthuyduong/fungiclassifiers](https://github.com/vuthuyduong/fungiclassifiers).
