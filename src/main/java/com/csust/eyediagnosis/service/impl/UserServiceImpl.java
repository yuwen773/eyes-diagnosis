package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.constant.UserConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.enums.UserRole;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisReexamineDTO;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.dto.user.UserEditDTO;
import com.csust.eyediagnosis.model.dto.user.UserQueryDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.user.LoginUserVO;
import com.csust.eyediagnosis.model.vo.user.UserVO;
import com.csust.eyediagnosis.security.PasswordService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.utils.DateRanges;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static com.csust.eyediagnosis.constant.FileConstant.PICTURE_FAIL_UPLOAD;
import static com.csust.eyediagnosis.constant.OrderConstant.ASC;
import static com.csust.eyediagnosis.constant.ReexamineConstant.REEXAMINE_STATUS_WAITING;
import static com.csust.eyediagnosis.constant.UserConstant.*;

/**
* @author 钰玟
* @description 针对表【t_user(用户)】的数据库操作Service实现
* @createDate 2025-04-12 15:23:32
*/

@Service
@Slf4j
public class UserServiceImpl extends ServiceImpl<UserMapper, User>
    implements UserService {

    @Resource
    private FileManager fileManager;
    @Resource
    private DiagnosisMapper diagnosisMapper;
    @Resource
    private PasswordService passwordService;
    /**
     * 用户注册
     *
     * @param userAccount   用户账户
     * @param userPassword  用户密码
     * @param checkPassword 校验密码
     * @return 新用户 id
     */
    @Override
    public long userRegister(String userAccount, String userPassword, String checkPassword) {
        //1. 数据校验
        if(StrUtil.hasBlank(userAccount,userPassword,checkPassword)){
            // 是否有空格
            throw new BusinessException(ErrorCode.PARAMS_ERROR, UserConstant.PARAMS_IS_NULL);
        }
        if(userAccount.length()<UserConstant.ACCOUNT_MIN_LENGTH ){
            // 账户是否符合 长度要求
            throw new BusinessException(ErrorCode.PARAMS_ERROR,ACCOUNT_IS_SHORT);
        }
        if(userPassword.length() <PASSWORD_MIN_LENGTH || checkPassword.length()<UserConstant.PASSWORD_MIN_LENGTH){
            // 密码是否符合 长度要求
            throw new BusinessException(ErrorCode.PARAMS_ERROR,PASSWORD_IS_SHORT);
        }
        if(!userPassword.equals(checkPassword)){
            //两次密码不一致
            throw new BusinessException(ErrorCode.PARAMS_ERROR,DOUBLE_PASSWORD_NOT_EQUAL);
        }
        //2. 判断 用户名是否唯一
        QueryWrapper<User> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("userAccount",userAccount);
        Long accountNum = this.getBaseMapper().selectCount(queryWrapper);
        if(accountNum>0){
            throw new BusinessException(ErrorCode.PARAMS_ERROR,ACCOUNT_REPEATED);
        }
        //3. 加密 数据（BCrypt cost 12）
        String encryptPassword = passwordService.encode(userPassword);

        //4. 注册该用户(插入数据)
        User user = new User();
        user.setUserAccount(userAccount);
        user.setUserPassword(encryptPassword);
        user.setUserName("无名");
        user.setUserRole(UserRole.USER.getValue());
        boolean saveResult = this.save(user);
        // 判断是否 注册成功
        if(!saveResult){
            throw new BusinessException(ErrorCode.SYSTEM_ERROR,FAIL_REGISTER);
        }
        return user.getId();
    }
    /**
     * 用户登录
     * @param userAccount 登录账号
     * @param userPassword 登录密码
     * @return VO对象 (脱敏后的对象)
     */
    @Override
    public LoginUserVO userLogin(String userAccount, String userPassword, HttpServletRequest request) {
        //1. 数据校验
        if(StrUtil.hasBlank(userAccount,userPassword)){
            throw new BusinessException(ErrorCode.PARAMS_ERROR, UserConstant.PARAMS_IS_NULL);
        }
        if(userAccount.length()<UserConstant.ACCOUNT_MIN_LENGTH){
            throw new BusinessException(ErrorCode.PARAMS_ERROR,ACCOUNT_ERROR);
        }
        if(userPassword.length() <PASSWORD_MIN_LENGTH){
            throw new BusinessException(ErrorCode.PARAMS_ERROR,PASSWORD_ERROR);
        }
        QueryWrapper<User> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("userAccount",userAccount);
        User user = this.getBaseMapper().selectOne(queryWrapper);
        if (user == null) {
            log.info("user login failed, userAccount cannot match userPassword");
            throw new BusinessException(ErrorCode.PARAMS_ERROR, FAIL_LOGIN);
        }
        // 校验密码：支持 BCrypt 与 legacy MD5
        PasswordService.PasswordVerification verification =
                passwordService.verify(userPassword, user.getUserPassword());
        if (!verification.matches()) {
            log.info("user login failed, userAccount cannot match userPassword");
            throw new BusinessException(ErrorCode.PARAMS_ERROR, FAIL_LOGIN);
        }
        // legacy MD5 命中后即时升级为 BCrypt
        if (verification.needsUpgrade()) {
            User passwordUpgrade = new User();
            passwordUpgrade.setId(user.getId());
            passwordUpgrade.setUserPassword(passwordService.encode(userPassword));
            this.updateById(passwordUpgrade);
        }
        // 记录用户的登录状态
        request.getSession().setAttribute(USER_LOGIN_STATE,user);
        return this.getLoginUserVO(user);
    }

    /**
     * 获取当前登录用户
     * @param request 请求
     * @return 用户
     */
    @Override
    public User getLoginUser(HttpServletRequest request) {
        // 先判断是否登录
        //1. 从Session 中获取存入的User对象
        Object userObj = request.getSession().getAttribute(USER_LOGIN_STATE);
        //强转
        User currentUser = (User) userObj;
        if(currentUser==null || currentUser.getId()==null){
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        //从数据库 查询( 追求性能可以注释，直接返回上述结果)
        long userId = currentUser.getId();
        currentUser = this.getById(userId);
        if (currentUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        return currentUser;
    }

    /**
     * 获取脱敏的已登录用户信息
     * @param user 用户
     * @return 脱敏对象
     */
    @Override
    public LoginUserVO getLoginUserVO(User user) {
        if(user == null){
            return null;
        }
        LoginUserVO loginUserVO = new LoginUserVO();
        BeanUtil.copyProperties(user,loginUserVO);
        return loginUserVO;
    }

    @Override
    public Boolean userLogout(HttpServletRequest request) {
        //先判断是否登录
        Object user = request.getSession().getAttribute(USER_LOGIN_STATE);
        if(user==null){
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR,NO_LOGIN);
        }
        request.getSession().removeAttribute(USER_LOGIN_STATE);
        return Boolean.TRUE;
    }
    /**
     * 获取user vo
     * @param user user
     * @return userVO
     */
    @Override
    public UserVO getUserVO(User user) {
        if(user == null){
            return null;
        }
        UserVO userVO = new UserVO();
        BeanUtil.copyProperties(user,userVO);
        return userVO;
    }
    /**
     * 获取user列表
     * @param userList 列表
     * @return VO列表
     */
    @Override
    public List<UserVO> getUserVOList(List<User> userList) {
        if(CollUtil.isEmpty(userList)){
            return new ArrayList<>();
        }
        //使用流转换
//        return userList.stream().map(user -> {
//            UserVO userVO = new UserVO();
//            BeanUtil.copyProperties(user,userVO);
//            return userVO;
//        }).collect(Collectors.toList());

        //直接调用方法
        return userList.stream().map(this::getUserVO).collect(Collectors.toList());
    }

    /**
     * 列表排序字段白名单。
     *
     * <p>排序字段是从请求体里来的字符串，直接拼进 ORDER BY 等于把 SQL 片段
     * 交给客户端。这里只认这五个列名，其余一律忽略（退化为默认排序）。
     */
    private static final Set<String> USER_SORT_FIELDS = Set.of(
            "id", "userAccount", "userName", "userRole", "createTime");

    @Override
    public QueryWrapper<User> getUserQueryWrapper(UserQueryDTO userQueryDTO) {
        if(userQueryDTO == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, UserConstant.PARAMS_IS_NULL);
        }
        //提取查询的字段
        Long userId = userQueryDTO.getId();
        String userAccount = userQueryDTO.getUserAccount();
        String userName = userQueryDTO.getUserName();
        String userProfile = userQueryDTO.getUserProfile();
        String userRole = userQueryDTO.getUserRole();
        String sortField = userQueryDTO.getSortField();
        String sortOrder = userQueryDTO.getSortOrder();
        //构建query对象
        QueryWrapper<User> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq(ObjUtil.isNotNull(userId),"id",userId);
        // 角色筛选：管理端要能一眼分开「管理员 / 普通用户 / 已封禁」，
        // 这一条以前是被注释掉的，接口收了参数却从不生效。
        queryWrapper.eq(StrUtil.isNotBlank(userRole),"userRole",userRole);
        queryWrapper.like(StrUtil.isNotBlank(userAccount),"userAccount",userAccount);
        queryWrapper.like(StrUtil.isNotBlank(userName),"userName",userName);
        queryWrapper.like(StrUtil.isNotBlank(userProfile),"userProfile",userProfile);
        // 注册时间区间
        queryWrapper.ge(DateRanges.start(userQueryDTO.getStartDate()) != null,"createTime",
                DateRanges.start(userQueryDTO.getStartDate()));
        queryWrapper.le(DateRanges.end(userQueryDTO.getEndDate()) != null,"createTime",
                DateRanges.end(userQueryDTO.getEndDate()));
        // 排序字段走白名单；未指定时默认按注册时间倒序（管理端最先看最新的人）
        String safeSortField = StrUtil.isNotBlank(sortField) && USER_SORT_FIELDS.contains(sortField)
                ? sortField : null;
        if (safeSortField != null) {
            queryWrapper.orderBy(true, ASC.equals(sortOrder), safeSortField);
        } else {
            queryWrapper.orderByDesc("createTime");
        }
        //返回query
        return queryWrapper;
    }

    @Override
    public boolean isAdmin(User user) {

            return user != null && UserRole.ADMIN.getValue().equals(user.getUserRole());

    }

    /**
     * 上传用户头像
     * @param multipartFile  文件
     * @param userEditDTO userDTO
     * @param loginUser 当前用户
     * @return
     */
    @Override
    public UserVO uploadUserAvatar(MultipartFile multipartFile, UserEditDTO userEditDTO, User loginUser) {
        //是否有权限
        ThrowUtils.throwIf(loginUser==null, ErrorCode.NO_AUTH_ERROR);
        //上传图片
        //用户Id作为每个用户的图库前缀
        String uploadPrefix = String.format("public/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        //获取图片url
        String avatarUrl = uploadPictureDetail.getUrl();
        User user = new User();
        user.setId(loginUser.getId());
        user.setUserAvatar(avatarUrl);
        //更新
        int result = this.baseMapper.updateById(user);
        //从数据库中获取用户信息
        User updateUser = this.getById(loginUser.getId());
        //插入/更新
        ThrowUtils.throwIf(result<0,ErrorCode.OPERATION_ERROR,PICTURE_FAIL_UPLOAD);
        UserVO userVO = new UserVO();
        BeanUtils.copyProperties(updateUser,userVO);
        return userVO;
    }
    /**
     * 用户申请复诊
     * @param diagnosisReexamineDTO 复诊信息
     * @param loginUser 当前用户
     */
    @Override
    public int reexamineDiagnosis(DiagnosisReexamineDTO diagnosisReexamineDTO, User loginUser) {
        ThrowUtils.throwIf(diagnosisReexamineDTO.getId()<=0,ErrorCode.PARAMS_ERROR);
        Diagnosis diagnosis = diagnosisMapper.selectById(diagnosisReexamineDTO.getId());
        if(!diagnosis.getUserId().equals(loginUser.getId())){
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        diagnosis.setReexamineStatus(REEXAMINE_STATUS_WAITING);
        return  diagnosisMapper.updateById(diagnosis);

    }

    @Override
    public boolean updateOwnProfile(UserEditDTO input, User loginUser) {
        ThrowUtils.throwIf(loginUser == null || loginUser.getId() == null, ErrorCode.NO_AUTH_ERROR);
        ThrowUtils.throwIf(input == null, ErrorCode.PARAMS_ERROR);
        User update = new User();
        update.setId(loginUser.getId());
        update.setUserName(input.getUserName());
        update.setUserAvatar(input.getUserAvatar());
        update.setUserProfile(input.getUserProfile());
        return this.updateById(update);
    }

    @Override
    public String encodePassword(String rawPassword) {
        return passwordService.encode(rawPassword);
    }

    /**
     * 可由管理员直接指派给用户的角色。
     *
     * <p>{@code ban} 是封禁档：账号还在、不能登录，用来表达「先停用」而不是删除。
     */
    private static final Set<String> ASSIGNABLE_ROLES = Set.of("user", "ban", "admin");

    @Override
    public BatchResultVO deleteUsers(List<Long> userIds) {
        List<Long> targets = normalizeIds(userIds);
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            User target = this.getById(id);
            if (target == null) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：用户不存在");
                continue;
            }
            if (AuthConstant.ADMIN_ROLE.equals(target.getUserRole())) {
                // 管理员账号不可删：删掉之后这套系统就没人能管了。
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：管理员账号不可删除");
                continue;
            }
            if (this.removeById(id)) {
                succeeded++;
            } else {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：删除失败");
            }
        }
        String message = reasons.isEmpty()
                ? "已删除 " + succeeded + " 个用户"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    @Override
    public BatchResultVO updateUserRole(List<Long> userIds, String userRole) {
        ThrowUtils.throwIf(!ASSIGNABLE_ROLES.contains(userRole), ErrorCode.PARAMS_ERROR,
                "角色只能是 user / ban / admin");
        List<Long> targets = normalizeIds(userIds);
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            User target = this.getById(id);
            if (target == null) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：用户不存在");
                continue;
            }
            if (AuthConstant.ADMIN_ROLE.equals(target.getUserRole())
                    && !AuthConstant.ADMIN_ROLE.equals(userRole)) {
                // 降级管理员要走单条复核通道，不在批量动作里顺手做掉。
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：管理员账号不可批量降级");
                continue;
            }
            User patch = new User();
            patch.setId(id);
            patch.setUserRole(userRole);
            if (this.updateById(patch)) {
                succeeded++;
            } else {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：角色更新失败");
            }
        }
        String message = reasons.isEmpty()
                ? "已更新 " + succeeded + " 个用户的角色"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    /** id 列表去重 + 去空。 */
    private List<Long> normalizeIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<Long> unique = new LinkedHashSet<>();
        for (Long id : ids) {
            if (id != null && id > 0) {
                unique.add(id);
            }
        }
        return new ArrayList<>(unique);
    }
}




