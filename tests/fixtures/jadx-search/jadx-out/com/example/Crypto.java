package com.example;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class Crypto {
    private static final String ALG = "AES/CBC/PKCS5Padding";

    public byte[] encrypt(byte[] key, byte[] plain) throws Exception {
        SecretKeySpec spec = new SecretKeySpec(key, "AES");
        Cipher cipher = Cipher.getInstance(ALG);
        cipher.init(Cipher.ENCRYPT_MODE, spec);
        return cipher.doFinal(plain);
    }
}
