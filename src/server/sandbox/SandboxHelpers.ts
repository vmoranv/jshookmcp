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
        a = ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
        a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
        a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
        a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
        a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
        a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
        a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
        a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
        a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
        a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
        a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
        a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
        a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
        a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
        a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
        a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
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
      for (i = i - 64; i < n; i++) {
        tail[i>>2] |= str.charCodeAt(i) << ((i%4)<<3);
      }
      tail[i>>2] |= 0x80 << ((i%4)<<3);
      if (i > 55) { md5cycle(state, tail); for (j = 0; j < 16; j++) tail[j] = 0; }
      tail[14] = n * 8;
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
      for(i=7;i>=0;i--)msg.push((bits>>>(i*8))&0xff);
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
