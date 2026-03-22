
class MinHashLSHForest {

    /*

    The LSH Forest for MinHash. It supports top-k query in Jaccard
    similarity.
    Instead of using prefix trees as the `original paper
    <http://ilpubs.stanford.edu:8090/678/1/2005-14.pdf>`_,
    I use a sorted array to store the hash values in every
    hash table.

    Args:
        num_perm (int, optional): The number of permutation functions used
            by the MinHash to be indexed. For weighted MinHash, this
            is the sample size (`sample_size`).
        l (int, optional): The number of prefix trees as described in the
            paper.
    Note:
        The MinHash LSH Forest also works with weighted Jaccard similarity
        and weighted MinHash without modification.

     */

    constructor({num_perm= 128, l=8  }= {}) {

        if (l <= 0 || num_perm <= 0){
            throw new Error("num_perm and l must be positive")
        }
        if (l > num_perm ){
            throw new Error("l cannot be greater than num_perm")
        }

        // Number of prefix trees
        this.l = l

        //Maximum depth of the prefix tree
        this.k = parseInt(num_perm / l)
        this.hashtables = Array.apply(null, Array(this.l)).map(_ => new Map());
        this.hashranges = Array.apply(null, Array(this.l)).map((val, i) => [i*this.k, (i+1)*this.k]);
        this.keys = new Map()

        // This is the sorted array implementation for the prefix trees
        this.sorted_hashtables = Array(this.l).fill([])

    }

    add(key, minhash){
        /*
        Add a unique key, together with a MinHash (or weighted MinHash) of
        the set referenced by the key.
        Note:
            The key won't be searchbale until the
            MinHashLSHForest.index method is called.
        Args:
            key (hashable): The unique identifier of the set.
            minhash (MinHash): The MinHash of the set.
         */

        if (minhash.length < this.k*this.l){
            throw new Error("The num_perm of MinHash out of range")
        }

        if (this.keys.has(key)){
            throw new Error("The given key has already been added")
        }

        this.keys.set(key, this.hashranges.map(range => this._H(minhash.hashvalues.slice(range[0],range[1]))));

        this.zip(this.keys.get(key), this.hashtables).forEach( function(e) {
            if (!e[1].has(e[0])) {
                e[1].set(e[0], [key]);
            } else {
                let l = e[1].get(e[0]);
                l.push(key)
            }
        });
    }

    zip() {
        var args = [].slice.call(arguments);
        var shortest = args.length === 0 ? [] : args.reduce(function(a,b){
            return a.length<b.length ? a : b
        });

        return shortest.map(function(_,i){
            return args.map(function(array){return array[i]})
        });
    }

    index(){

        /*
        Index all the keys added so far and make them searchable.
         */

        for (const [i, hashtable] of this.hashtables.entries()) {
            this.sorted_hashtables[i] = Array.from(hashtable.keys(), (v) => new Uint8Array(this._H(v)));
            this.sorted_hashtables[i].sort(function (a, b){
                for (let x=0; x<a.length; x++){
                    if (a[x] < b[x]) return -1;
                    else if (a[x] > b[x]) return 1;
                }
                return 0;
            });
        }


    }

     *_query(minhash, r, b){

         if (r > this.k || r <=0 || b > this.l || b <= 0){
            throw new Error("parameter outside range")
         }

         // Generate prefixes of concatenated hash values
         var hps = this.hashranges.map(range => new Uint8Array(this._H(minhash.hashvalues.slice(range[0],range[0]+r))));

         // Set the prefix length for look-ups in the sorted hash values list
         var prefix_size = hps[0].length


         for (var triple of this.zip(this.sorted_hashtables, hps, this.hashtables)){
             var ht  = triple[0]
             var hp  = triple[1]
             var hashtable  = triple[2]
             var compare_array_equal = function(a1,prefix_size,a2){
                 for (let i=0; i < prefix_size; i++) {
                     if (a1[i] !== a2[i]) return false;
                 }
                 return true;
             }

             var search_function = function(x){
                 for (let i=0; i < prefix_size; i++) {
                     if (ht[x][i] < hp[i]) return false;
                     else if (ht[x][i] > hp[i]) return true;
                 }
                 return true;
             }

             var i = this._binary_search(ht.length, search_function)

             // bugs because return undefined. it hsouild be i < ht.length -1
             if (ht[i]){

                 //if (i < ht.length && ht[i].split(',').slice(0, prefix_size) == hp) {
                 if (i < ht.length &&  compare_array_equal(ht[i],prefix_size,hp ) ) {

                     var j = i

                     //while (j < ht.length && ht[j].slice(0, prefix_size) == hp) {
                     while (j < ht.length && compare_array_equal(ht[j],prefix_size,hp )) {


                        //yield hashtable[ht[j]]
                        for (let key of hashtable.get(ht[j].buffer)){
                            yield key;
                        }


                         j += 1
                     }
                 }
             }




        }

    }

    query(minhash, k){

        /*
        Return the approximate top-k keys that have the
        (approximately) highest Jaccard similarities to the query set.
            Args:
        minhash (MinHash): The MinHash of the query set.
        k (int): The maximum number of keys to return.
        Returns:
            list of at most k keys.

            Note:
        Tip for improving accuracy:
            you can use a multiple of `k` (e.g., `2*k`) in the argument,
            compute the exact (or approximate using MinHash) Jaccard
        similarities of the sets referenced by the returned keys,
            from which you then take the final top-k. This is often called
        "post-processing". Because the total number of similarity
        computations is still bounded by a constant multiple of `k`, the
        performance won't degrade too much -- however you do have to keep
        the original sets (or MinHashes) around some where so that you
        can make references to them.

         */

        if (k <= 0){
            throw new Error("k must be positive")
        }

        if (minhash.length <= this.k*this.l){
            throw new Error("The num_perm of MinHash out of range")
        }

        var results = new Set()
        var r = this.k
        while (r > 0){

            var g  = this._query(minhash, r, this.l)

            for (var key of g ){

                results.add(key)

                if (results.size >= k){
                    return Array.from(results)
                }

            }
            r -= 1

        }
        return Array.from(results)

    }

    _binary_search(n, func){
        /*
        https://golang.org/src/sort/search.go?s=2247:2287#L49


         */


        var i = 0;
        var j = n;


        while (i < j){

            var h = parseInt(i + (j - i) / 2)

            if (!func(h)){
                i = h + 1
            }

            else {
                j = h
            }
        }

        return i
    }

    _H(hs){

        return new BigUint64Array(hs).buffer
    }

}


exports.MinHashLSHForest = MinHashLSHForest