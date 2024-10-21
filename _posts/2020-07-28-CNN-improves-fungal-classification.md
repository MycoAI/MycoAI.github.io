---
title: "Convolutional neural networks improve fungal classification"
layout: post
---

[Our paper](https://www.nature.com/articles/s41598-020-69245-y) titled "Convolutional Neural Networks Improve Fungal Classification", which applies the deep learning approach to fungal classification, has been published.

<b>Abstract: </b>Sequence classification plays an important role in metagenomics studies. 
We assess the deep neural network approach for fungal sequence classification as it has emerged as a successful paradigm for big data classification and clustering. 
Two deep learning-based classifiers, a convolutional neural network (CNN) and a deep belief network (DBN) were trained using our recently released barcode datasets. 
Experimental results show that CNN outperformed the traditional BLAST classification and the most accurate machine learning based Ribosomal Database Project (RDP) 
classifier on datasets that had many of the labels present in the training datasets. When classifying an independent dataset namely the “Top 50 Most Wanted Fungi”, 
CNN and DBN assigned less sequences than BLAST. However, they could assign much more sequences than the RDP classifier. 
In terms of efficiency, it took the machine learning classifiers up to two seconds to classify a test dataset while it was 53 s for BLAST. 
The result of the current study will enable us to speed up the taxonomic assignments for the fungal barcode sequences generated at our institute as ~ 70% of 
them still need to be validated for public release. In addition, it will help to quickly provide a taxonomic profile for metagenomics samples.

<b>Github: </b>[https://github.com/vuthuyduong/fungiclassifiers](https://github.com/vuthuyduong/fungiclassifiers)

![image](https://github.com/user-attachments/assets/01df3c97-92c0-4165-b423-00d8e9b85db5)

