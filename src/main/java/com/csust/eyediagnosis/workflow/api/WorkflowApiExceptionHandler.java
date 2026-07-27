package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.workflow.exception.InvalidReviewDecisionException;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowTransitionException;
import com.csust.eyediagnosis.workflow.review.ReviewTaskConflictException;
import com.csust.eyediagnosis.workflow.review.ReviewTaskNotFoundException;
import com.csust.eyediagnosis.workflow.review.ReviewTaskStateException;
import com.csust.eyediagnosis.workflow.review.UnauthorizedReviewActionException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps the frozen workflow-domain exceptions to the API error contract so that authorization,
 * not-found, conflict and invalid-decision cases return precise HTTP statuses / codes instead of
 * falling through to a generic 500.
 *
 * <p>Ordered before {@code GlobalExceptionHandler}: the latter has an {@code Exception.class}
 * catch-all which would otherwise swallow the workflow-domain runtime exceptions into a 500.</p>
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class WorkflowApiExceptionHandler {

    @ExceptionHandler(UnauthorizedReviewActionException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public BaseResponse<?> handleUnauthorized(UnauthorizedReviewActionException e) {
        return ResultUtils.error(ErrorCode.FORBIDDEN_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(ReviewTaskNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public BaseResponse<?> handleNotFound(ReviewTaskNotFoundException e) {
        return ResultUtils.error(ErrorCode.NOT_FOUND_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(ReviewTaskStateException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public BaseResponse<?> handleState(ReviewTaskStateException e) {
        return ResultUtils.error(ErrorCode.OPERATION_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(ReviewTaskConflictException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public BaseResponse<?> handleConflict(ReviewTaskConflictException e) {
        return ResultUtils.error(ErrorCode.OPERATION_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(InvalidReviewDecisionException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public BaseResponse<?> handleInvalidDecision(InvalidReviewDecisionException e) {
        return ResultUtils.error(ErrorCode.PARAMS_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(InvalidWorkflowTransitionException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public BaseResponse<?> handleTransition(InvalidWorkflowTransitionException e) {
        return ResultUtils.error(ErrorCode.FORBIDDEN_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(InvalidWorkflowContractException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public BaseResponse<?> handleContract(InvalidWorkflowContractException e) {
        return ResultUtils.error(ErrorCode.PARAMS_ERROR.getCode(), e.getMessage());
    }
}
