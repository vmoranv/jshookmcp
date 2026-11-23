/**
 * SandboxHelpers — Pre-built pure-JS utility libraries for the sandbox.
 *
 * These helpers are evaluated inside QuickJS before user code runs,
 * providing common utilities (base64, hex, hashing, JSON, array, string)
 * without requiring Node.js APIs.
 */

/**
 * Pure-JS source string that is eval'd inside the sandbox environment.
 * All implementations are self-contained with no external dependencies.
 */
export const SANDBOX_HELPER_SOURCE = `
(function() {
  var helpers = {};

  // ── base64 ──
  helpers.base64 = {
    _chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
    encode: function(str) {
      var output = '';
      var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
      var i = 0;
      while (i < str.length) {
        chr1 = str.charCodeAt(i++);
        chr2 = str.charCodeAt(i++);
        chr3 = str.charCodeAt(i++);
        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;
        if (isNaN(chr2)) { enc3 = enc4 = 64; }
        else if (isNaN(chr3)) { enc4 = 64; }
        output += this._chars.charAt(enc1) + this._chars.charAt(enc2) +
                  this._chars.charAt(enc3) + this._chars.charAt(enc4);
      }
      return output;
    },
    decode: function(str) {
      var output = '';
      var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
      var i = 0;
      str = str.replace(/[^A-Za-z0-9+/=]/g, '');
      while (i < str.length) {
        enc1 = this._chars.indexOf(str.charAt(i++));
        enc2 = this._chars.indexOf(str.charAt(i++));
        enc3 = this._chars.indexOf(str.charAt(i++));
        enc4 = this._chars.indexOf(str.charAt(i++));
        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;
        output += String.fromCharCode(chr1);
        if (enc3 !== 64) output += String.fromCharCode(chr2);
        if (enc4 !== 64) output += String.fromCharCode(chr3);
      }
      return output;
    }
  };

  // ── hex ──
  helpers.hex = {
    encode: function(str) {
      var hex = '';
      for (var i = 0; i < str.length; i++) {
        hex += ('0' + str.charCodeAt(i).toString(16)).slice(-2);
      }
      return hex;
    },
    decode: function(hex) {
      var str = '';
      for (var i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
      return str;
    }
  };

  // ── hash (simple djb2/fnv for in-sandbox use; NOT cryptographic!) ──
  helpers.hash = {
    djb2: function(str) {
      var hash = 5381;
      for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit
      }
      return (hash >>> 0).toString(16);
    },
    fnv1a: function(str) {
      var hash = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16);
    },
    /** Simple MD5 — pure JS implementation */
    md5: function(str) {
      // Lightweight MD5 for sandbox use
      function md5cycle(x, k) {
        var a = x[0], b = x[1], c = x[2], d = x[3];
        a = ff(a,b,c,d,k[0],7,0xd76aa478);
        d=ff(d,a,b,c,k[1],12,0xe8c7b756);
        c=ff(c,d,a,b,k[2],17,0x242070db);
        b=ff(b,c,d,a,k[3],22,0xc1bdceee);
        a=ff(a,b,c,d,k[4],7,0xf57c0faf);
        d=ff(d,a,b,c,k[5],12,0x4787c62a);
        c=ff(c,d,a,b,k[6],17,0xa8304613);
        b=ff(b,c,d,a,k[7],22,0xfd469501);
        a=ff(a,b,c,d,k[8],7,0x698098d8);
        d=ff(d,a,b,c,k[9],12,0x8b44f7af);
        c=ff(c,d,a,b,k[10],17,0xffff5bb1);
        b=ff(b,c,d,a,k[11],22,0x895cd7be);
        a=ff(a,b,c,d,k[12],7,0x6b901122);
        d=ff(d,a,b,c,k[13],12,0xfd987193);
        c=ff(c,d,a,b,k[14],17,0xa679438e);
        b=ff(b,c,d,a,k[15],22,0x49b40821);
        a=gg(a,b,c,d,k[1],5,0xf61e2562);
        d=gg(d,a,b,c,k[6],9,0xc040b340);
        c=gg(c,d,a,b,k[11],14,0x265e5a51);
        b=gg(b,c,d,a,k[0],20,0xe9b6c7aa);
        a=gg(a,b,c,d,k[5],5,0xd62f105d);
        d=gg(d,a,b,c,k[10],9,0x02441453);
        c=gg(c,d,a,b,k[15],14,0xd8a1e681);
        b=gg(b,c,d,a,k[4],20,0xe7d3fbc8);
        a=gg(a,b,c,d,k[9],5,0x21e1cde6);
        d=gg(d,a,b,c,k[14],9,0xc33707d6);
        c=gg(c,d,a,b,k[3],14,0xf4d50d87);
        b=gg(b,c,d,a,k[8],20,0x455a14ed);
        a=gg(a,b,c,d,k[13],5,0xa9e3e905);
        d=gg(d,a,b,c,k[2],9,0xfcefa3f8);
        c=gg(c,d,a,b,k[7],14,0x676f02d9);
        b=gg(b,c,d,a,k[12],20,0x8d2a4c8a);
        a=hh(a,b,c,d,k[5],4,0xfffa3942);
        d=hh(d,a,b,c,k[8],11,0x8771f681);
        c=hh(c,d,a,b,k[11],16,0x6d9d6122);
        b=hh(b,c,d,a,k[14],23,0xfde5380c);
        a=hh(a,b,c,d,k[1],4,0xa4beea44);
        d=hh(d,a,b,c,k[4],11,0x4bdecfa9);
        c=hh(c,d,a,b,k[7],16,0xf6bb4b60);
        b=hh(b,c,d,a,k[10],23,0xbebfbc70);
        a=hh(a,b,c,d,k[13],4,0x289b7ec6);
        d=hh(d,a,b,c,k[0],11,0xeaa127fa);
        c=hh(c,d,a,b,k[3],16,0xd4ef3085);
        b=hh(b,c,d,a,k[6],23,0x04881d05);
        a=hh(a,b,c,d,k[9],4,0xd9d4d039);
        d=hh(d,a,b,c,k[12],11,0xe6db99e5);
        c=hh(c,d,a,b,k[15],16,0x1fa27cf8);
        b=hh(b,c,d,a,k[2],23,0xc4ac5665);
        a=ii(a,b,c,d,k[0],6,0xf4292244);
        d=ii(d,a,b,c,k[7],10,0x432aff97);
        c=ii(c,d,a,b,k[14],15,0xab9423a7);
        b=ii(b,c,d,a,k[5],21,0xfc93a039);
        a=ii(a,b,c,d,k[12],6,0x655b59c3);
        d=ii(d,a,b,c,k[3],10,0x8f0ccc92);
        c=ii(c,d,a,b,k[10],15,0xffeff47d);
        b=ii(b,c,d,a,k[1],21,0x85845dd1);
        a=ii(a,b,c,d,k[8],6,0x6fa87e4f);
        d=ii(d,a,b,c,k[15],10,0xfe2ce6e0);
        c=ii(c,d,a,b,k[6],15,0xa3014314);
        b=ii(b,c,d,a,k[13],21,0x4e0811a1);
        a=ii(a,b,c,d,k[4],6,0xf7537e82);
        d=ii(d,a,b,c,k[11],10,0xbd3af235);
        c=ii(c,d,a,b,k[2],15,0x2ad7d2bb);
        b=ii(b,c,d,a,k[9],21,0xeb86d391);
        x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);
      }
      function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b)}
      function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
      function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
      function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
      function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
      function add32(a,b){return(a+b)&0xFFFFFFFF}

      var n = str.length;
      var state = [1732584193,-271733879,-1732584194,271733878];
      var tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      var i;
      for (i = 64; i <= n; i += 64) {
        var blk = [];
        for (var j = i - 64; j < i; j += 4) {
          blk.push(str.charCodeAt(j)|(str.charCodeAt(j+1)<<8)|(str.charCodeAt(j+2)<<16)|(str.charCodeAt(j+3)<<24));
        }
        md5cycle(state, blk);
      }
      for (var j = 0; j < 16; j++) tail[j] = 0;
      // 'i' is an absolute string offset after the block loop; the tail block
      // needs block-relative indices, otherwise bytes >= 64 land past tail[15]
      // and the real trailing data is hashed as an all-zero block.
      var t = 0;
      for (i = i - 64; i < n; i++, t++) {
        tail[t>>2] |= str.charCodeAt(i) << ((t%4)<<3);
      }
      tail[t>>2] |= 0x80 << ((t%4)<<3);
      if (t > 55) { md5cycle(state, tail); for (j = 0; j < 16; j++) tail[j] = 0; }
      tail[14] = n * 8;
      tail[15] = Math.floor(n / 0x20000000) | 0;
      md5cycle(state, tail);

      var hex_chr = '0123456789abcdef';
      var s = '';
      for (i = 0; i < 4; i++) {
        for (j = 0; j < 4; j++) {
          s += hex_chr.charAt((state[i] >> (j*8+4)) & 0x0F) + hex_chr.charAt((state[i] >> (j*8)) & 0x0F);
        }
      }
      return s;
    },
    sha256: function(str) {
      // Minimal pure-JS SHA-256
      var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
               0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
               0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
               0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
               0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
               0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
               0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
               0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
      function rr(x,n){return(x>>>n)|(x<<(32-n))}
      var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
      var msg=[];
      for(var i=0;i<str.length;i++)msg.push(str.charCodeAt(i));
      msg.push(0x80);
      var l=msg.length;
      while(l%64!==56){msg.push(0);l++;}
      var bits=str.length*8;
      // JS shift counts are taken modulo 32, so (bits >>> (i*8)) for i >= 4
      // re-reads the low word instead of shifting in zeros. Emit the 64-bit
      // big-endian length explicitly.
      var hi=Math.floor(bits/0x100000000);
      var lo=bits>>>0;
      msg.push((hi>>>24)&0xff,(hi>>>16)&0xff,(hi>>>8)&0xff,hi&0xff,
               (lo>>>24)&0xff,(lo>>>16)&0xff,(lo>>>8)&0xff,lo&0xff);
      for(var offset=0;offset<msg.length;offset+=64){
        var W=[];
        for(i=0;i<16;i++)W[i]=(msg[offset+i*4]<<24)|(msg[offset+i*4+1]<<16)|(msg[offset+i*4+2]<<8)|msg[offset+i*4+3];
        for(i=16;i<64;i++){
          var s0=rr(W[i-15],7)^rr(W[i-15],18)^(W[i-15]>>>3);
          var s1=rr(W[i-2],17)^rr(W[i-2],19)^(W[i-2]>>>10);
          W[i]=(W[i-16]+s0+W[i-7]+s1)|0;
        }
        var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for(i=0;i<64;i++){
          var S1=rr(e,6)^rr(e,11)^rr(e,25);
          var ch=(e&f)^((~e)&g);
          var t1=(h+S1+ch+K[i]+W[i])|0;
          var S0=rr(a,2)^rr(a,13)^rr(a,22);
          var maj=(a&b)^(a&c)^(b&c);
          var t2=(S0+maj)|0;
          h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
        }
        H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
        H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
      }
      var hex='';
      for(i=0;i<8;i++)for(var j=7;j>=0;j--)hex+='0123456789abcdef'.charAt((H[i]>>>(j*4))&0xf);
      return hex;
    }
  };

  // ── json ──
  helpers.json = {
    safeParse: function(str) {
      try { return { ok: true, value: JSON.parse(str) }; }
      catch(e) { return { ok: false, error: e.message }; }
    }
  };

  // ── array ──
  helpers.array = {
    chunk: function(arr, size) {
      // A non-positive size never advances 'i' (size === 0) or moves backwards
      // (size < 0), hanging the sandbox until the interrupt handler fires.
      if (!(size > 0)) return [];
      var result = [];
      for (var i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
      }
      return result;
    },
    flatten: function(arr) {
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i])) {
          result = result.concat(this.flatten(arr[i]));
        } else {
          result.push(arr[i]);
        }
      }
      return result;
    },
    unique: function(arr) {
      var seen = {};
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        var key = JSON.stringify(arr[i]);
        if (!seen[key]) {
          seen[key] = true;
          result.push(arr[i]);
        }
      }
      return result;
    }
  };

  // ── string ──
  helpers.string = {
    camelCase: function(s) {
      return s.replace(/[-_\\s]+(\\w)/g, function(_, c) { return c.toUpperCase(); })
              .replace(/^\\w/, function(c) { return c.toLowerCase(); });
    },
    snakeCase: function(s) {
      return s.replace(/([A-Z])/g, '_$1').toLowerCase()
              .replace(/[-\\s]+/g, '_')
              .replace(/^_/, '');
    },
    truncate: function(s, len) {
      if (s.length <= len) return s;
      return s.slice(0, len - 3) + '...';
    }
  };

  // Expose to global scope
  globalThis.helpers = helpers;
})();
`;
