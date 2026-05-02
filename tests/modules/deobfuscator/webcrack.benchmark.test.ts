/**
 * JsDeObsBench-style benchmark test — verifies webcrack can deobfuscate
 * all 7 javascript-obfuscator single transforms + 1 combined transform.
 *
 * These samples match the JsDeObsBench evaluation categories:
 *   string_array, string_array_rotate, control_flow_flattening,
 *   dead_code_injection, numbers_to_expressions, simplify,
 *   rename_vars, combined
 */
import { describe, expect, it } from 'vitest';
import { runWebcrack } from '@modules/deobfuscator/webcrack';

// Original clean code used to generate all samples:
//   function add(a, b) { return a + b; }
//   function greet(name) { return "Hello, " + name + "!"; }

const SAMPLES: Record<string, string> = {
  string_array:
    "(function(_0x30c671,_0x31e349){var _0x6c5ac8=_0x38c7,_0x41cbeb=_0x30c671();while(!![]){try{var _0x20cf5b=-parseInt(_0x6c5ac8(0x92))/0x1*(-parseInt(_0x6c5ac8(0x99))/0x2)+parseInt(_0x6c5ac8(0x95))/0x3+parseInt(_0x6c5ac8(0x93))/0x4*(parseInt(_0x6c5ac8(0x91))/0x5)+parseInt(_0x6c5ac8(0x9c))/0x6*(parseInt(_0x6c5ac8(0x98))/0x7)+parseInt(_0x6c5ac8(0x9b))/0x8*(parseInt(_0x6c5ac8(0x9a))/0x9)+parseInt(_0x6c5ac8(0x96))/0xa+-parseInt(_0x6c5ac8(0x94))/0xb*(parseInt(_0x6c5ac8(0x97))/0xc);if(_0x20cf5b===_0x31e349)break;else _0x41cbeb['push'](_0x41cbeb['shift']());}catch(_0x1ff73d){_0x41cbeb['push'](_0x41cbeb['shift']());}}}(_0x1bff,0x202d4));function add(_0xe49711,_0x2c3304){return _0xe49711+_0x2c3304;}function _0x38c7(_0x5eab45,_0x40dafd){_0x5eab45=_0x5eab45-0x91;var _0x1bff2a=_0x1bff();var _0x38c70e=_0x1bff2a[_0x5eab45];return _0x38c70e;}function greet(_0x136a05){var _0x333cbc=_0x38c7;return _0x333cbc(0x9d)+_0x136a05+'!';}function _0x1bff(){var _0x143afb=['8GaraMh','150hFiZuk','Hello,\\x20','509930czzrBH','1CnWqFu','8OnGGHw','2747921zshlBh','446394qEJCzT','1210470ahhpkp','36PyUFKM','29078SsWkKr','355066cbHqBr','1134261XwKqMl'];_0x1bff=function(){return _0x143afb;};return _0x1bff();}",

  string_array_rotate:
    "(function(_0x58bb7c,_0x406bfb){var _0x95ed63=_0x434d,_0x5a81f8=_0x58bb7c();while(!![]){try{var _0x4391c8=parseInt(_0x95ed63(0x7f))/0x1+parseInt(_0x95ed63(0x80))/0x2+parseInt(_0x95ed63(0x7e))/0x3+parseInt(_0x95ed63(0x86))/0x4+-parseInt(_0x95ed63(0x82))/0x5*(parseInt(_0x95ed63(0x83))/0x6)+-parseInt(_0x95ed63(0x84))/0x7+parseInt(_0x95ed63(0x7d))/0x8*(parseInt(_0x95ed63(0x81))/0x9);if(_0x4391c8===_0x406bfb)break;else _0x5a81f8['push'](_0x5a81f8['shift']());}catch(_0x165b25){_0x5a81f8['push'](_0x5a81f8['shift']());}}}(_0x46c3,0x4ddf7));function _0x46c3(){var _0x245a60=['230OmANix','81834vqGzaf','3554586lcPONy','Hello,\\x20','2202476DSXSgA','3024hJTnFC','1107531rWhVPq','195746IScHEs','243290KNyRHm','5166kmcUbI'];_0x46c3=function(){return _0x245a60;};return _0x46c3();}function _0x434d(_0x148d3c,_0x34b22a){_0x148d3c=_0x148d3c-0x7d;var _0x46c319=_0x46c3();var _0x434d0c=_0x46c319[_0x148d3c];return _0x434d0c;}function add(_0x2ba8ed,_0x2cd865){return _0x2ba8ed+_0x2cd865;}function greet(_0x36fe8d){var _0x13c3b0=_0x434d;return _0x13c3b0(0x85)+_0x36fe8d+'!';}",

  control_flow_flattening:
    "(function(_0x420990,_0x35edf0){var _0x550ed6=_0x2de6,_0x1f76c5=_0x420990();while(!![]){try{var _0x3df1ee=parseInt(_0x550ed6(0xb1))/0x1+-parseInt(_0x550ed6(0xaa))/0x2+parseInt(_0x550ed6(0xad))/0x3*(parseInt(_0x550ed6(0xa7))/0x4)+parseInt(_0x550ed6(0xa6))/0x5*(-parseInt(_0x550ed6(0xae))/0x6)+-parseInt(_0x550ed6(0xa8))/0x7+-parseInt(_0x550ed6(0xb0))/0x8+parseInt(_0x550ed6(0xa9))/0x9;if(_0x3df1ee===_0x35edf0)break;else _0x1f76c5['push'](_0x1f76c5['shift']());}catch(_0x2b0432){_0x1f76c5['push'](_0x1f76c5['shift']());}}}(_0x5f1b,0xe9e34));function add(_0x3f5364,_0x19ad15){return _0x3f5364+_0x19ad15;}function _0x5f1b(){var _0x494a66=['4391024TthFHZ','661049bvQXoc','10JYCxIH','88984KAeCZm','13153077bOLTJJ','29465613CogMYn','1750774BTMPFx','NSGBb','Hello,\\x20','96nTmOJL','1156794CChTuU','fscuW'];_0x5f1b=function(){return _0x494a66;};return _0x5f1b();}function _0x2de6(_0x1be8bb,_0x29d19e){_0x1be8bb=_0x1be8bb-0xa6;var _0x5f1bca=_0x5f1b();var _0x2de676=_0x5f1bca[_0x1be8bb];return _0x2de676;}function greet(_0xc87b5b){var _0x3b87d5=_0x2de6,_0x100a34={'NSGBb':function(_0x5f3167,_0x19f603){return _0x5f3167+_0x19f603;},'fscuW':_0x3b87d5(0xac)};return _0x100a34['NSGBb'](_0x100a34[_0x3b87d5(0xab)](_0x100a34[_0x3b87d5(0xaf)],_0xc87b5b),'!');}",

  dead_code_injection:
    "(function(_0x172a04,_0x43cf11){var _0x18bf58=_0x51e7,_0x29cdce=_0x172a04();while(!![]){try{var _0x4e21a4=parseInt(_0x18bf58(0x1c2))/0x1*(parseInt(_0x18bf58(0x1c0))/0x2)+parseInt(_0x18bf58(0x1c5))/0x3*(-parseInt(_0x18bf58(0x1c6))/0x4)+-parseInt(_0x18bf58(0x1bf))/0x5+-parseInt(_0x18bf58(0x1c7))/0x6*(parseInt(_0x18bf58(0x1c1))/0x7)+-parseInt(_0x18bf58(0x1ca))/0x8*(parseInt(_0x18bf58(0x1c3))/0x9)+parseInt(_0x18bf58(0x1bd))/0xa*(-parseInt(_0x18bf58(0x1be))/0xb)+parseInt(_0x18bf58(0x1c8))/0xc*(parseInt(_0x18bf58(0x1c9))/0xd);if(_0x4e21a4===_0x43cf11)break;else _0x29cdce['push'](_0x29cdce['shift']());}catch(_0x2f5234){_0x29cdce['push'](_0x29cdce['shift']());}}}(_0x183b,0xf198b));function add(_0x1a5344,_0x413e83){return _0x1a5344+_0x413e83;}function greet(_0x254b73){var _0x1fec7c=_0x51e7;return _0x1fec7c(0x1c4)+_0x254b73+'!';}function _0x51e7(_0x3e4aea,_0x21ef4a){_0x3e4aea=_0x3e4aea-0x1bd;var _0x183bc7=_0x183b();var _0x51e779=_0x183bc7[_0x3e4aea];return _0x51e779;}function _0x183b(){var _0x1f5141=['7VeMqHl','475148WdVvGB','13671tZJPfq','Hello,\\x20','6stOOWJ','1584668LfNTMd','6099990lfNJwT','36dZVyfW','13831987LNCOIl','1568TRTxDK','4713640qhWMmZ','11PlGOat','5248875BGEIVW','6zerhjB'];_0x183b=function(){return _0x1f5141;};return _0x183b();}",

  numbers_to_expressions:
    "(function(_0x15538c,_0x14a985){var _0x6c8957=_0x3f9f,_0x145b41=_0x15538c();while(!![]){try{var _0xd2e3ee=parseInt(_0x6c8957(0xb4))/(0x1135+-0x140e*0x1+0x2da)+parseInt(_0x6c8957(0xb6))/(-0x4*-0x8d1+-0x2674+0x332)+-parseInt(_0x6c8957(0xb8))/(-0xb2e+-0x2*-0x4cd+-0x1*-0x197)+parseInt(_0x6c8957(0xb5))/(-0x13*-0xad+-0x53*0xf+-0x7f6)*(-parseInt(_0x6c8957(0xb7))/(-0x1*-0x98+-0xb*0x324+0x21f9))+-parseInt(_0x6c8957(0xb1))/(0x68b+-0x2118+0x1*0x1a93)+-parseInt(_0x6c8957(0xaf))/(0x1ee3*-0x1+0x656+0x1894)*(parseInt(_0x6c8957(0xb0))/(-0x264a+0xf3f+-0x7b1*-0x3))+parseInt(_0x6c8957(0xb2))/(0x1f10+0xb*0x1d2+-0x7*0x74b)*(parseInt(_0x6c8957(0xb9))/(-0xbaf*0x2+-0x52*-0x40+0x2e8));if(_0xd2e3ee===_0x14a985)break;else _0x145b41['push'](_0x145b41['shift']());}catch(_0x47810f){_0x145b41['push'](_0x145b41['shift']());}}}(_0x2909,0x151c28+0x631*-0x169+0x2051a));function _0x3f9f(_0x79f939,_0xe7b27c){_0x79f939=_0x79f939-(0x25ac+-0x3*0x2d5+-0x1c7e);var _0x26cdf4=_0x2909();var _0xb5c26b=_0x26cdf4[_0x79f939];return _0xb5c26b;}function add(_0x3f22de,_0x1ac816){return _0x3f22de+_0x1ac816;}function _0x2909(){var _0x101fc1=['1605810cKcCNu','7339585FpUnZJ','694917oCXwJF','10xDmjHu','2786QGDGHz','25736kMgGSp','3893622uIcUBr','26913195AoGjkb','Hello,\\x20','779256EIDvHa','4dqQVvu'];_0x2909=function(){return _0x101fc1;};return _0x2909();}function greet(_0x27f632){var _0x4df495=_0x3f9f;return _0x4df495(0xb3)+_0x27f632+'!';}",

  simplify:
    "function _0x4b93(_0x1f0112,_0x5d1ee7){_0x1f0112=_0x1f0112-0x1f1;var _0x14454b=_0x1445();var _0x4b931f=_0x14454b[_0x1f0112];return _0x4b931f;}(function(_0xda226a,_0x73b877){var _0x12ab68=_0x4b93,_0x106317=_0xda226a();while(!![]){try{var _0x1a1ba9=parseInt(_0x12ab68(0x1f2))/0x1+-parseInt(_0x12ab68(0x1f3))/0x2+parseInt(_0x12ab68(0x1f9))/0x3+parseInt(_0x12ab68(0x1f1))/0x4+parseInt(_0x12ab68(0x1f5))/0x5*(-parseInt(_0x12ab68(0x1f8))/0x6)+parseInt(_0x12ab68(0x1f4))/0x7+-parseInt(_0x12ab68(0x1f7))/0x8;if(_0x1a1ba9===_0x73b877)break;else _0x106317['push'](_0x106317['shift']());}catch(_0x396ab5){_0x106317['push'](_0x106317['shift']());}}}(_0x1445,0x83b51));function add(_0x2c4523,_0x3f8045){return _0x2c4523+_0x3f8045;}function _0x1445(){var _0x24c689=['3030276xbsORZ','1076672excOaT','118815QvLGSh','324224rLbHnJ','3760722iYFjnj','70RNQMdt','Hello,\\x20','7604800czfdNi','121344KNrQPM'];_0x1445=function(){return _0x24c689;};return _0x1445();}function greet(_0x4649e3){var _0x9b961e=_0x4b93;return _0x9b961e(0x1f6)+_0x4649e3+'!';}",

  rename_vars:
    "function T(P,o){P=P-0x1eb;var O=b();var c=O[P];return c;}(function(O,c){var D=T,J=O();while(!![]){try{var y=-parseInt(D(0x1f3))/0x1*(parseInt(D(0x1f4))/0x2)+-parseInt(D(0x1ef))/0x3*(-parseInt(D(0x1ee))/0x4)+-parseInt(D(0x1f0))/0x5+parseInt(D(0x1f2))/0x6*(-parseInt(D(0x1eb))/0x7)+-parseInt(D(0x1ed))/0x8+-parseInt(D(0x1ec))/0x9*(-parseInt(D(0x1f6))/0xa)+-parseInt(D(0x1f7))/0xb*(-parseInt(D(0x1f5))/0xc);if(y===c)break;else J['push'](J['shift']());}catch(e){J['push'](J['shift']());}}}(b,0xba035));function P(O,c){return O+c;}function b(){var S=['4PkytrQ','1462200vbXOdw','2877425HtSYNL','Hello,\\x20','618jgLmfY','33290kMFPZR','6ktDWfj','4811088bnypPG','75290eMonhU','33NBwaFQ','38997LNiAsB','1017NWXpqD','4238976UMfhLE'];b=function(){return S;};return b();}function o(O){var x=T;return x(0x1f1)+O+'!';}",

  combined:
    "(function(P,o){var D=T,O=P();while(!![]){try{var c=-parseInt(D(0x190))/(0x13b1+-0x98e+-0xa22)+parseInt(D(0x195))/(0x9a9*0x1+0x2273+-0x2c1a)*(parseInt(D(0x191))/(-0x109c+0x6*-0x2e1+0x21e5))+-parseInt(D(0x18b))/(-0x2633*-0x1+-0x5*-0x4e7+-0x19*0x282)*(parseInt(D(0x18f))/(0x1*0x20a9+0x39d*-0x1+-0x1*0x1d07))+-parseInt(D(0x197))/(-0x1df9+0x7*-0x49d+0x86*0x77)+parseInt(D(0x198))/(0xca*-0x5+-0x5*-0x55e+-0x16dd)+parseInt(D(0x18e))/(-0x1432+-0x46a+0x18a4)+parseInt(D(0x18d))/(-0xa86+-0x1*-0x26fa+0x5*-0x5af)*(parseInt(D(0x196))/(0xca5+-0xe1d+-0x1*-0x182));if(c===o)break;else O['push'](O['shift']());}catch(e){O['push'](O['shift']());}}}(b,0x61bbd+-0x6143*0x6+0x1a*0x4e0d));function J(P,o){var x=T,O={'hyleI':function(c,e){return c+e;}};return O[x(0x194)](P,o);}function y(P){var S=T,o={'DFWaJ':function(O,c){return O+c;},'ljPml':function(O,c){return O+c;}};return o[S(0x193)](o[S(0x18c)](S(0x192),P),'!');}function T(P,o){P=P-(0x44*-0x79+0x168c+0xb23*0x1);var O=b();var c=O[P];return c;}function b(){var K=['8660939bJfnYC','212948MORUuR','ljPml','49788IFLwiK','1440336kXKYjW','110XkFPsZ','916725YmWTHx','3EyICJY','Hello,\\x20','DFWaJ','hyleI','1862824vitiMR','1330XbGUCW','1356714Qpgrdk'];b=function(){return K;};return b();}",
};

function isValidJS(code: string): boolean {
  try {
    // oxlint-disable-next-line no-new
    new Function(code);
    return true;
  } catch {
    return false;
  }
}

describe('webcrack benchmark — JsDeObsBench transforms', () => {
  const OPTIONS = { unminify: true, unpack: true, mangle: false, jsx: false };

  for (const [name, sample] of Object.entries(SAMPLES)) {
    describe(`transform: ${name}`, () => {
      it('applies successfully (applied: true)', async () => {
        const result = await runWebcrack(sample, OPTIONS);
        expect(result.applied).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('produces syntactically valid JavaScript', async () => {
        const result = await runWebcrack(sample, OPTIONS);
        expect(result.applied).toBe(true);
        expect(isValidJS(result.code)).toBe(true);
      });

      it('recovers the "Hello, " string literal', async () => {
        const result = await runWebcrack(sample, OPTIONS);
        expect(result.applied).toBe(true);
        expect(result.code).toContain('Hello, ');
      });

      it('produces output shorter than input', async () => {
        const result = await runWebcrack(sample, OPTIONS);
        expect(result.applied).toBe(true);
        expect(result.code.length).toBeLessThan(sample.length);
      });
    });
  }

  it('passes all 8 transforms', async () => {
    const results = await Promise.all(
      Object.entries(SAMPLES).map(async ([name, sample]) => {
        const result = await runWebcrack(sample, OPTIONS);
        return { name, applied: result.applied, hasHello: result.code.includes('Hello, ') };
      }),
    );

    const failures = results.filter((r) => !r.applied);
    const missingStrings = results.filter((r) => r.applied && !r.hasHello);

    expect(failures).toEqual([]);
    expect(missingStrings).toEqual([]);
  });
});
