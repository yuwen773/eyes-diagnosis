package com.csust.eyediagnosis.aop;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.enums.UserRole;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;


/**
 * @ClassNameAuthInterceptor
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/12 下午5:12
 * @Version 1.0
 **/

@Aspect
@Component
public class AuthInterceptor {
    @Resource
    private UserService userService;

    /**
     * 执行拦截
     * @param joinPoint 切入点
     * @param authCheck 权限校验注解
     * @return
     * @throws Throwable
     */
    @Around("@annotation(authCheck)")
    public Object authCheck(ProceedingJoinPoint joinPoint, AuthCheck authCheck) throws Throwable {
        String mustRole = authCheck.mustRole();
        RequestAttributes requestAttributes = RequestContextHolder.currentRequestAttributes();
        HttpServletRequest httpServletRequest = ((ServletRequestAttributes)requestAttributes).getRequest();
        //当前登录用户
        User loginUser = userService.getLoginUser(httpServletRequest);
        UserRole mustRoleEnum = UserRole.getEnumByValue(mustRole);

        //不需要权限，放行
        if(mustRoleEnum == null){
            return joinPoint.proceed();
        }
        //以下为必须要有权限才能通过
        // 获取当前用户具有的权限
        UserRole userRole = UserRole.getEnumByValue(loginUser.getUserRole());
        if(userRole == null){
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // PR-12.3 权限矩阵：
        //   mustRole=admin   -> 仅管理员
        //   mustRole=doctor  -> 仅医生（人工复核提交/认领是医疗行为，管理员不可代签）
        //   mustRole=auditor -> 审计员或管理员（审计视图）
        //   mustRole=user    -> 任意已登录角色
        if (!allowed(mustRoleEnum, userRole)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        return joinPoint.proceed();
    }

    /** PR-12.3 role decision matrix. */
    public static boolean allowed(UserRole mustRole, UserRole actual) {
        return switch (mustRole) {
            case ADMIN -> actual == UserRole.ADMIN;
            case DOCTOR -> actual == UserRole.DOCTOR;
            case AUDITOR -> actual == UserRole.AUDITOR || actual == UserRole.ADMIN;
            case USER -> true;
        };
    }
}
