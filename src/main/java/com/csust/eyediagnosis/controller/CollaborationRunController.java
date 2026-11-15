package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.collaboration.*;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.UserConstant;
import com.csust.eyediagnosis.model.entity.User;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.session.SessionRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.function.LongSupplier;

@RestController
@RequestMapping("/agent/collaboration-runs")
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationRunController {
    private final CollaborationRunService runs;
    private final CollaborationStreams streams;
    private final ObjectProvider<SessionRepository<?>> repositories;
    private final CollaborationImages images;

    public CollaborationRunController(CollaborationRunService runs, CollaborationStreams streams, ObjectProvider<SessionRepository<?>> repositories, CollaborationImages images) {
        this.runs = runs; this.streams = streams; this.repositories = repositories; this.images = images;
    }

    @ModelAttribute
    public void privateResponse(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @PostMapping
    public BaseResponse<CollaborationRunService.Snapshot> create(@RequestBody CollaborationRunService.Create request, HttpServletRequest servlet) {
        return ResultUtils.success(runs.create(identity(servlet).getAsLong(), request));
    }
    @GetMapping("/{runId}")
    public BaseResponse<CollaborationRunService.Snapshot> get(@PathVariable String runId, HttpServletRequest servlet) {
        return ResultUtils.success(runs.snapshot(runId, identity(servlet).getAsLong()));
    }
    @GetMapping("/operations")
    public BaseResponse<CollaborationRunService.Operations> operations(HttpServletRequest servlet) {
        return ResultUtils.success(runs.operations(identity(servlet).getAsLong()));
    }
    @GetMapping("/{runId}/image")
    public ResponseEntity<byte[]> image(@PathVariable String runId, HttpServletRequest servlet) {
        var image = images.read(runId, identity(servlet).getAsLong());
        return ResponseEntity.ok().header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "inline; filename=fundus." + image.format())
                .contentType(org.springframework.http.MediaType.parseMediaType(image.format().equals("png") ? "image/png" : "image/jpeg"))
                .body(image.bytes());
    }
    @GetMapping(value = "/{runId}/events", produces = "text/event-stream")
    public SseEmitter events(@PathVariable String runId, @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId,
                             @RequestParam(required = false) String cursor, HttpServletRequest servlet, jakarta.servlet.http.HttpServletResponse response) {
        LongSupplier identity = identity(servlet);
        var subscription = runs.subscribe(runId, identity.getAsLong(), lastEventId, cursor);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Accel-Buffering", "no");
        return streams.open(subscription, identity);
    }
    @PostMapping("/{runId}/cancel")
    public BaseResponse<CollaborationRunService.Cancellation> cancel(@PathVariable String runId, HttpServletRequest servlet) {
        return ResultUtils.success(runs.cancel(runId, identity(servlet).getAsLong()));
    }

    /** Re-read the server-side session on every batch/send; a captured HttpSession would retain stale grants. */
    private LongSupplier identity(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
        var repository = repositories.getIfAvailable();
        if (repository == null) throw new CollaborationRunService.Fault(503, "SESSION_REVALIDATION_UNAVAILABLE");
        String id = session.getId();
        return () -> {
            var current = repository.findById(id);
            Object attribute = current == null || current.isExpired() ? null : current.getAttribute(UserConstant.USER_LOGIN_STATE);
            if (!(attribute instanceof User user) || user.getId() == null) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
            return user.getId();
        };
    }

    @ExceptionHandler(CollaborationRunService.Fault.class)
    public ResponseEntity<BaseResponse<?>> fault(CollaborationRunService.Fault failure) {
        return ResponseEntity.status(failure.status()).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(ResultUtils.error(failure.status() * 100, failure.getMessage()));
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<BaseResponse<?>> invalidRequest() { return fault(new CollaborationRunService.Fault(400, "INVALID_REQUEST")); }
}
