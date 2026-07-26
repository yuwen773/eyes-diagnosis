package com.csust.eyediagnosis.workflow.inference;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class InferenceIdempotencyKeyFactoryTest { @Test void isStableAndEpochScoped() { InferenceIdempotencyKeyFactory factory = new DefaultInferenceIdempotencyKeyFactory(); assertEquals("w:g:a:IMAGE_INFERENCE:4", factory.create("w","g","a",4)); assertNotEquals(factory.create("w","g","a",4), factory.create("w","g","a",5)); } }
