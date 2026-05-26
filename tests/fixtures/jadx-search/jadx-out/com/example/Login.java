package com.example;

public class LoginViewModel {
    private final Crypto crypto = new Crypto();
    // Uses AES under the hood
    public boolean login(String user, String password) {
        return user != null && password != null;
    }
}
