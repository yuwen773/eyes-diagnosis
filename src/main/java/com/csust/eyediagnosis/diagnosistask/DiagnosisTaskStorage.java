package com.csust.eyediagnosis.diagnosistask;

public interface DiagnosisTaskStorage {
    String upload(String key, byte[] bytes, String contentType);
    byte[] readVersion(String key, String version);
}
