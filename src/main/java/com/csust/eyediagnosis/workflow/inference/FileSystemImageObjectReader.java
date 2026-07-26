package com.csust.eyediagnosis.workflow.inference;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Explicitly local reader used by the workflow boundary; remote storage is not silently fetched. */
@Component
public final class FileSystemImageObjectReader implements ImageObjectReader {
    @Override
    public byte[] read(String imageObjectReference) {
        try {
            String path = imageObjectReference.startsWith("file:")
                    ? Path.of(java.net.URI.create(imageObjectReference)).toString() : imageObjectReference;
            return Files.readAllBytes(Path.of(path));
        } catch (IOException | IllegalArgumentException exception) {
            throw new IllegalArgumentException("image object is unavailable", exception);
        }
    }
}
