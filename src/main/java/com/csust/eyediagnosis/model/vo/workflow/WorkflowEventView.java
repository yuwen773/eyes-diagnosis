package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * One entry of the append-only workflow audit timeline, exposed for the frontend progress bar.
 */
@Data
public class WorkflowEventView implements Serializable {
    private String type;
    private LocalDateTime time;
    private String segment;
}
