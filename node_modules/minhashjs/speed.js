const MH = require("./MinHash");
const F = require('./ForestLSH.js');


console.time("Empty MinHash with 128 permutations 10000 Times")
for (var p = 0; p < 10000; p++){ new MH.MinHash() }
console.timeEnd("Empty MinHash with 128 permutations 10000 Times")

console.time("Empty MinHash with 256 permutations 10000 Times")
for (var p = 0; p < 10000; p++){ new MH.MinHash(num_perm = 256) }
console.timeEnd("Empty MinHash with 256 permutations 10000 Times")

console.time("Sample text with 128 permutations 10000 Times")
data1 = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']
for (var p = 0; p < 10000; p++){
    var m1 = new MH.MinHash(num_perm = 128)
    data1.forEach((d, i) => m1.update(d));
}
console.timeEnd("Sample text with 128 permutations 10000 Times")


console.time("Sample text with 256 permutations 10000 Times")
data1 = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']
for (var p = 0; p < 10000; p++){
    var m1 = new MH.MinHash(num_perm = 256)
    data1.forEach((d, i) => m1.update(d));
}
console.timeEnd("Sample text with 256 permutations 10000 Times")


console.time("Jaccard with 256 permutations 10000 Times")

data1 = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']

data2 = ['minhash', 'is', 'a',  'data', 'structure', 'for',
    'estimating', 'the', 'similarity', 'between']


var m1 = new MH.MinHash(num_perm = 256)
var m2 = new MH.MinHash(num_perm = 256)

data1.forEach((d, i) => m1.update(d));
data2.forEach((d, i) => m2.update(d));

for (var p = 0; p < 10000; p++){
    m1.jaccard(m2)
}
console.timeEnd("Jaccard with 256 permutations 10000 Times")


console.time("Create a 10 000 LSH and search 10 000 times")

const data = require('./test.accuraccy.json');
const repo = {}


var forest = new F.MinHashLSHForest(num_perm=128)

cpt=0
for (var i = 0; i < data.datum.length; i++){

    data1 = data.datum[i][0]

    m1 = new MH.MinHash()
    data1.forEach((d, i) => m1.update(d));



    forest.add('m' + cpt, m1)
    cpt += 1
}


forest.index()

for (var i = 0; i < data.datum.length; i++){

    data2 = data.datum[i][1]

    m2 = new MH.MinHash()
    data2.forEach((d, i) => m2.update(d));

    var result = forest.query(m2, 2)

}

console.timeEnd("Create a 10 000 LSH and search 10 000 times")