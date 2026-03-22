<h1 align="center">Welcome to minhashjs</h1>
<p>
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-blue.svg?cacheSeconds=2592000" />
  <a href="https://github.com/F4llis/minhashjs#readme" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
  <a href="https://github.com/F4llis/minhashjs/graphs/commit-activity" target="_blank">
    <img alt="Maintenance" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" />
  </a>
  <a href="https://github.com/F4llis/minhashjs/blob/master/LICENSE" target="_blank">
    <img alt="License: ISC" src="https://img.shields.io/github/license/F4llis/minhashjs" />
  </a>
</p>

> MinHash and LSH in JavaScript (Datasketch implementation)

## Install

```sh
npm i minhashjs
```

## MinHash Usage

```js
const MH = require('./MinHash.js');

first_sentence = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']

second_sentence = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']

// First, instanciate the MinHash object
m1 = new MH.MinHash()
m2 = new MH.MinHash()

// Then, update each MinHash
first_sentence.forEach((d, i) => m1.update(d));
second_sentence.forEach((d, i) => m2.update(d));

// You can now compute the jaccard distance between these two hashes
m1.jaccard(m2)
```

## LSH Usage

```js
const F = require('./ForestLSH.js');
const MH = require("./MinHash");

var data1 = ['minhash', 'is', 'a', 'probabilistic', 'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between', 'datasets']
var data2 = ['minhash', 'dog', 'data', 'structure', 'for',
    'fork', 'twice', 'similarity', 'food', 'money']
var data3 = ['minhash', 'is', 'probability', 'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between', 'documents']

// Create MinHash objects
var m1 = new MH.MinHash(num_perm=128)
var m2 = new MH.MinHash(num_perm=128)
var m3 = new MH.MinHash(num_perm=128)

// Update the hashes
data1.forEach((d, i) => m1.update(d));
data2.forEach((d, i) => m2.update(d));
data3.forEach((d, i) => m3.update(d));


// Create a MinHash LSH Forest with the same num_perm parameter
var forest = new F.MinHashLSHForest(num_perm=128)

// Add m2 and m3 into the index
forest.add("m2", m2)
forest.add("m3", m3)

//IMPORTANT: must call index() otherwise the keys won't be searchable
forest.index()


// Using m1 as the query, retrieve top X keys that have the higest Jaccard
var X = 2
let r = forest.query(m1, X)
```

## Run tests

```sh
npm run test
```

## Run speed tests

```sh
npm run speed
```


## 🤝 Contributing

Contributions, issues and feature requests are welcome!<br />Feel free to check [issues page](https://github.com/F4llis/minhashjs/issues). 

## 📝 License

Copyright © 2022 [F4llis](https://github.com/F4llis).<br />
This project is [ISC](https://github.com/F4llis/minhashjs/blob/master/LICENSE) licensed.

