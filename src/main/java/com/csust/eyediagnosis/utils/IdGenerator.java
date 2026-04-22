package com.csust.eyediagnosis.utils;

import java.util.UUID;

public class IdGenerator {
    public static String idStr() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}