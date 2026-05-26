#!/usr/bin/env tsx
/**
 * Build the mini jadx-out fixture used by jadx-search tests.
 *
 * Output layout (under `tests/fixtures/jadx-search/jadx-out/`):
 *   com/example/Crypto.java     — contains "AES", "Cipher.getInstance", "SecretKeySpec"
 *   com/example/Api.java        — contains BASE_URL, "https://api.example.com"
 *   com/example/Login.java      — contains "LoginViewModel" + "AES" occurrence (multi-file hit)
 *   com/example/Utils.kt        — Kotlin source, tests Kotlin glob inclusion
 *   com/example/UserTest.java   — exists to verify `!**\/*Test.java` negative glob
 *   META-INF/MANIFEST.MF        — non-source file, verifies glob filtering
 *
 * Regenerate with:
 *   pnpm tsx tests/fixtures/jadx-search/build-jadx-out.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(FIXTURE_DIR, 'jadx-out');

const FILES: Array<{ path: string; content: string }> = [
  {
    path: 'com/example/Crypto.java',
    content: [
      'package com.example;',
      '',
      'import javax.crypto.Cipher;',
      'import javax.crypto.spec.SecretKeySpec;',
      '',
      'public class Crypto {',
      '    private static final String ALG = "AES/CBC/PKCS5Padding";',
      '',
      '    public byte[] encrypt(byte[] key, byte[] plain) throws Exception {',
      '        SecretKeySpec spec = new SecretKeySpec(key, "AES");',
      '        Cipher cipher = Cipher.getInstance(ALG);',
      '        cipher.init(Cipher.ENCRYPT_MODE, spec);',
      '        return cipher.doFinal(plain);',
      '    }',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'com/example/Api.java',
    content: [
      'package com.example;',
      '',
      'public class Api {',
      '    private static final String BASE_URL = "https://api.example.com";',
      '',
      '    public String getEndpoint() {',
      '        return BASE_URL + "/v1/login";',
      '    }',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'com/example/Login.java',
    content: [
      'package com.example;',
      '',
      'public class LoginViewModel {',
      '    private final Crypto crypto = new Crypto();',
      '    // Uses AES under the hood',
      '    public boolean login(String user, String password) {',
      '        return user != null && password != null;',
      '    }',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'com/example/Utils.kt',
    content: [
      'package com.example',
      '',
      'object Utils {',
      '    const val TAG: String = "AES-Utils"',
      '    fun greet(name: String): String = "Hello, $name"',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'com/example/UserTest.java',
    content: [
      'package com.example;',
      '',
      'public class UserTest {',
      '    public void testNothing() {}',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'META-INF/MANIFEST.MF',
    content:
      'Manifest-Version: 1.0\nCreated-By: jadx-search fixture\nAES=mentioned-but-not-source\n',
  },
];

export async function buildJadxOutFixture(targetDir: string = OUT_DIR): Promise<void> {
  for (const file of FILES) {
    const dest = join(targetDir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, 'utf8');
  }
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  buildJadxOutFixture(OUT_DIR)
    .then(() => {
      console.log(`[jadx-search fixture] wrote ${FILES.length} files to ${OUT_DIR}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
