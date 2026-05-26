package com.example;

public class Api {
    private static final String BASE_URL = "https://api.example.com";

    public String getEndpoint() {
        return BASE_URL + "/v1/login";
    }
}
