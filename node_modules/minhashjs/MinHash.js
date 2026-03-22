const crypto = require("crypto");

class MinHash {

    static _mersenne_prime = BigInt.asUintN(64,(BigInt(1) << BigInt(61))- BigInt(1))
    static _max_hash = BigInt.asUintN(64, (BigInt(1) << BigInt(32))-BigInt(1))
    static _hash_range = BigInt(1) << BigInt(32)  // 4 bytes
    static permutations = {};

    static sha1(data) {
        return BigInt(new Uint32Array(crypto.createHash("sha1").update(data, "binary").digest().buffer)[0])
    }

    static get_permutations(num_perm) {
        if (num_perm in MinHash.permutations){
            return MinHash.permutations[num_perm]
        }

        else{
            MinHash.permutations[num_perm] = MinHash.init_permutations(num_perm)
            return MinHash.permutations[num_perm]
        }

    }

    static init_permutations(num_perm){

        var mersenne_random = function(){
            return BigInt(new BigUint64Array(crypto.randomBytes(8).buffer)[0]) % MinHash._mersenne_prime
        }

        var mat = Array.from({length: num_perm}, () => [BigInt(1) + mersenne_random(),mersenne_random()])
        return  mat[0].map((_, colIndex) => mat.map(row => row[colIndex]));

    }

    /*
    MinHash is a probabilistic data structure for computing
    Jaccard similarity between sets.

    Args:
        num_perm (int, optional): Number of random permutation functions.
        It will be ignored if hashvalues is not None.
        seed (int, optional): The random seed controls the set of random
        permutation functions generated for this MinHash.

        hashfunc (optional): The hash function used by this MinHash.
        It takes the input passed to the update method and
        returns an integer that can be encoded with 32 bits.
        The default hash function is based on [XXX] SHA1 from hashlib_ [XXX].

        hashvalues (BigUint64Array, optional): The hash values is
        the internal state of the MinHash. It can be specified for faster
        initialization using the existing state from another MinHash.

        permutations (optional): The permutation function parameters. This argument
        can be specified for faster initialization using the existing
        state from another MinHash.


     */
    constructor( {num_perm= 128,  hashfunc=MinHash.sha1, hashvalues=null, }= {}){

        if (hashvalues !== null ) {
            num_perm = hashvalues.length
        }

        if (num_perm > MinHash._hash_range ){throw new Error(`Cannot have more than ${_hash_range} number of permutation functions`);}

        // Check the hash function.
        this.hashfunc = hashfunc
        this.num_perm = num_perm

        // Check for use of hashobj and issue warning.
        this.hashvalues = hashvalues !== null ? this._parse_hashvalues(hashvalues) : this._init_hashvalues(this.num_perm)

        // Set permutation function parameters
        this.permutations = MinHash.get_permutations(this.num_perm)

    }

    _init_hashvalues(num_perm){
        return new BigUint64Array(Array(num_perm).fill(MinHash._max_hash))
    }

    _parse_hashvalues(hashvalues){
        return new BigUint64Array(hashvalues)
    }

    update(b){
        /*  Update this MinHash with a new value.

       The value will be hashed using the hash function specified by
       the hashfunc argument in the constructor.

       Args:
           b: The value to be hashed using the hash function specified.

        */

        var hv = this.hashfunc(b)

        var a = this.permutations[0]
        var b = this.permutations[1]

        this.hashvalues = a.map((e, index) => {
            var c = ((e * hv + b[index]) % MinHash._mersenne_prime & MinHash._max_hash)
            return c < this.hashvalues[index] ? c : this.hashvalues[index]
        })

    }

    jaccard(other){
        /* Estimate the Jaccard similarity (resemblance) between the sets
        represented by this MinHash and the other.

        Args:
            other (this.MinHash): The other MinHash.

        Returns:
            float: The Jaccard similarity, which is between 0.0 and 1.0.

         */

        if (other.permutations !== this.permutations){
            throw new Error("Cannot compute Jaccard given MinHash with\
                    different permutation functions")
        }

        var inter = this.hashvalues.map((e, index) => e == other.hashvalues[index] ? 1: 0).reduce((partialSum, a) => partialSum + a, 0);

        return inter/ other.num_perm





    }

}

exports.MinHash = MinHash;

