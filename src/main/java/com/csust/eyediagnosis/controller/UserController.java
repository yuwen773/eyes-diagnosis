package com.csust.eyediagnosis.controller;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.BatchIdsRequest;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisReexamineDTO;
import com.csust.eyediagnosis.model.dto.user.*;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.user.LoginUserVO;
import com.csust.eyediagnosis.model.vo.user.UserVO;
import com.csust.eyediagnosis.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.beans.BeanUtils;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.util.DigestUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * @ClassNameUserController
 * @Description 用户控制层
 * @Author钰玟
 * @Date2025/4/10 下午8:42
 * @Version 1.0
 **/

@RestController
@RequestMapping("/user")
//@Api(tags = "用户相关接口")
public class UserController {

    @Resource
    private UserService userService;
    @Resource
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 用户注册
     * @param userRegisterDTO 注册数据传输模型
     * @return 用户Id
     */
    @PostMapping("/register")
    @Operation(summary ="用户注册")
    public BaseResponse<Long> userRegister(@RequestBody UserRegisterDTO userRegisterDTO){
        String userAccount = userRegisterDTO.getUserAccount();
        String userPassword = userRegisterDTO.getUserPassword();
        String userCheckPassword = userRegisterDTO.getCheckPassword();
        long result = userService.userRegister(userAccount, userPassword, userCheckPassword);
        return ResultUtils.success(result);
    }

    /**
     * 用户登录
     * @param userLoginDTO 用户登录数据传输模型
     * @return 用户登录展示模型
     */
    @PostMapping("/login")
    @Operation(summary ="用户登录")
    public BaseResponse<LoginUserVO> userLogin(@RequestBody UserLoginDTO userLoginDTO, HttpServletRequest request){
        ThrowUtils.throwIf(userLoginDTO==null, ErrorCode.PARAMS_ERROR);
        String userAccount = userLoginDTO.getUserAccount();
        String userPassword = userLoginDTO.getUserPassword();
        LoginUserVO userLoginVO = userService.userLogin(userAccount, userPassword,request);
        return ResultUtils.success(userLoginVO);
    }

    /**
     * 获取用户
     * @param request request
     * @return loginVO
     */
    @GetMapping("/get/login")
    @Operation(summary ="获取登录用户")
    public BaseResponse<LoginUserVO> getLoginUser(HttpServletRequest request){
        User loginUser = userService.getLoginUser(request);
        return ResultUtils.success(userService.getLoginUserVO(loginUser));
    }

    /**
     * 用户注销
     * @param request 请求
     * @return boolean
     */
    @PostMapping("/logout")
    @Operation(summary ="用户登出")
    public BaseResponse<Boolean> userLogout(HttpServletRequest request){
        ThrowUtils.throwIf(request==null, ErrorCode.PARAMS_ERROR);
        Boolean result = userService.userLogout(request);
        return ResultUtils.success(result);
    }

    /**
     * 增加用户
     * @param userAddDTO 增加用户的传输对象
     * @return long
     */
    @PostMapping("/add")
    @Operation(summary ="新增用户")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Long> userAdd(@RequestBody UserAddDTO userAddDTO){
        ThrowUtils.throwIf(userAddDTO==null, ErrorCode.PARAMS_ERROR);
        // 管理员必须显式提供初始密码；不得写入固定默认值
        ThrowUtils.throwIf(userAddDTO.getUserPassword() == null
                || userAddDTO.getUserPassword().isBlank(),
                ErrorCode.PARAMS_ERROR, "必须提供初始密码");
        ThrowUtils.throwIf(userAddDTO.getUserAccount() == null
                || userAddDTO.getUserAccount().isBlank(),
                ErrorCode.PARAMS_ERROR, "账号不能为空");
        // 角色只能取白名单里的三档，别让请求体把 userRole 写成任意字符串
        String role = userAddDTO.getUserRole() == null || userAddDTO.getUserRole().isBlank()
                ? "user" : userAddDTO.getUserRole();
        ThrowUtils.throwIf(!List.of("user", "ban", "admin").contains(role),
                ErrorCode.PARAMS_ERROR, "角色只能是 user / ban / admin");
        // 账号唯一：t_user 上有 uk_userAccount 唯一键，但让它在应用层先炸，
        // 回执是可读的业务错误，而不是一条看不懂的数据库约束冲突
        long existed = userService.count(new QueryWrapper<User>()
                .eq("userAccount", userAddDTO.getUserAccount()));
        ThrowUtils.throwIf(existed > 0, ErrorCode.PARAMS_ERROR, "账号已存在");
        User user = new User();
        // 仅复制安全字段；userPassword 走 BCrypt 单独写入
        BeanUtil.copyProperties(userAddDTO,user);
        user.setUserRole(role);
        String encoded = userService.encodePassword(userAddDTO.getUserPassword());
        user.setUserPassword(encoded);
        boolean result  = userService.save(user);
        ThrowUtils.throwIf(!result,ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(user.getId());
    }

    /**
     * 查询用户
     * @param id 用户id
     * @return 用户
     */
    @GetMapping("/get")
    @Operation(summary ="根据id查询用户")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<User> getUserById(@RequestParam("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        User user = userService.getById(id);
        ThrowUtils.throwIf(user==null, ErrorCode.NOT_FOUND_ERROR);
        return ResultUtils.success(user);
    }

    /**
     * 获取 脱敏用户
     * @param id 用户id
     * @return 脱敏用户对象
     */
    @GetMapping("/get/vo")
    @Operation(summary ="根据id查询脱敏用户")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<UserVO> getUserVOById(@RequestParam("id") Long id){
        BaseResponse<User> response = getUserById(id);
        User user = response.getData();
        return ResultUtils.success(userService.getUserVO(user));
    }
    /**
     * 更新用户
     */
    @PostMapping("/update")
    @Operation(summary ="更新用户信息")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> updateUser(@RequestBody UserUpdateDTO userUpdateDTO) {
        if (userUpdateDTO == null || userUpdateDTO.getId() == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        User user = new User();
        BeanUtils.copyProperties(userUpdateDTO, user);
        boolean result = userService.updateById(user);
        ThrowUtils.throwIf(!result, ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(true);
    }

    /**
     * 分页查询
     * @param userQueryDTO 查询DTO
     * @return
     */
    @PostMapping("/list/page/vo")
    @Operation(summary ="获取分页用户列表")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Page<UserVO>> listUserVOByPage(@RequestBody UserQueryDTO userQueryDTO){
        ThrowUtils.throwIf(userQueryDTO==null, ErrorCode.PARAMS_ERROR);
        // 获取分页相关数据
        long current = userQueryDTO.getCurrent();
        long pageSize = userQueryDTO.getPageSize();
        //分页查询
        Page<User> userPage = userService.page(new Page<>(current,pageSize),
                userService.getUserQueryWrapper(userQueryDTO));
        Page<UserVO> userVOPage = new Page<>(current,pageSize,userPage.getTotal());
        List<UserVO> userVOList = userService.getUserVOList(userPage.getRecords());
        userVOPage.setRecords(userVOList);
        return ResultUtils.success(userVOPage);
    }
    /**
     * 分页查询
     * @param userQueryDTO 查询DTO
     * @return
     */
    @PostMapping("/list/page/vo/cache")
    @Operation(summary ="获取分页用户列表（缓存版本）")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Page<UserVO>> listUserVOByPageWithCache(@RequestBody UserQueryDTO userQueryDTO){
        ThrowUtils.throwIf(userQueryDTO==null, ErrorCode.PARAMS_ERROR);
        // 获取分页相关数据
        long current = userQueryDTO.getCurrent();
        long pageSize = userQueryDTO.getPageSize();

        //1.从redis查询数据
        //1.1 redis 的key
        String queryCondition = JSONUtil.toJsonStr(userQueryDTO);
        String hashKey = DigestUtils.md5DigestAsHex(queryCondition.getBytes());
        String redisKey = String.format("diagnosis:listUserVOByPage:%s",hashKey);
        //1.2 从redis获取数据
        String cacheValue = stringRedisTemplate.opsForValue().get(redisKey);
        //2.判断缓存是否命中
        if(cacheValue !=null){
            Page<UserVO> cachePage = JSONUtil.toBean(cacheValue, Page.class);
            return ResultUtils.success(cachePage);
        }
        //3.未命中，查询数据库
        Page<User> userPage = userService.page(new Page<>(current,pageSize),
                userService.getUserQueryWrapper(userQueryDTO));
        //3.1 封装响应结果 为VO对象
        Page<UserVO> userVOPage = new Page<>(current,pageSize,userPage.getTotal());

        List<UserVO> userVOList = userService.getUserVOList(userPage.getRecords());
        userVOPage.setRecords(userVOList);
        //4. 缓存至redis
        String toCache = JSONUtil.toJsonStr(userVOPage);
        //4.1 5-10分钟，防止缓存雪崩
        int cacheExpireTime = 300 + RandomUtil.randomInt(0,300);
        stringRedisTemplate.opsForValue().set(redisKey,toCache,cacheExpireTime, TimeUnit.SECONDS);
        return ResultUtils.success(userVOPage);
    }
    /**
     * 根据id删除用户
     * @param id 用户id
     * @return boolean
     */
    @PostMapping("/delete/{id}")
    @Operation(summary ="删除用户")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> deleteUser(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        boolean result = userService.removeById(id);
        return ResultUtils.success(result);
    }

    /**
     * 批量删除用户：逐条执行，部分失败如实回执。
     */
    @PostMapping("/delete/batch")
    @Operation(summary ="批量删除用户")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<BatchResultVO> deleteUsersBatch(@RequestBody BatchIdsRequest batchRequest){
        ThrowUtils.throwIf(batchRequest==null, ErrorCode.PARAMS_ERROR);
        return ResultUtils.success(userService.deleteUsers(batchRequest.getIds()));
    }

    /**
     * 批量改角色（封禁 / 解封）：逐条执行，部分失败如实回执。
     */
    @PostMapping("/update/role/batch")
    @Operation(summary ="批量修改用户角色")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<BatchResultVO> updateUserRoleBatch(@RequestBody UserBatchRoleDTO roleRequest){
        ThrowUtils.throwIf(roleRequest==null, ErrorCode.PARAMS_ERROR);
        return ResultUtils.success(
                userService.updateUserRole(roleRequest.getIds(), roleRequest.getUserRole()));
    }

    @PostMapping("/update/userCenter")
    @Operation(summary ="用户中心更新")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Boolean> editUserCenter(@RequestBody UserEditDTO userEditDTO, HttpServletRequest request){
        ThrowUtils.throwIf(userEditDTO==null, ErrorCode.PARAMS_ERROR);
        User loginUser = userService.getLoginUser(request);
        boolean result = userService.updateOwnProfile(userEditDTO, loginUser);
        ThrowUtils.throwIf(!result, ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(true);
    }
    @PostMapping("/upload/avatar")
    @Operation(summary ="用户头像上传")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<UserVO> uploadAvatarPicture(@RequestPart("file") MultipartFile multipartFile,
                                                         UserEditDTO userEditDTO,
                                                         HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        UserVO userVO = userService.uploadUserAvatar(multipartFile,userEditDTO,loginUser);
        return ResultUtils.success(userVO);
    }


    @PostMapping("/diagnosis/reexamine")
    @Operation(summary ="用户申请复诊上传")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Boolean> reexamineDiagnosis(DiagnosisReexamineDTO diagnosisReexamineDTO, HttpServletRequest request) {
        //获取登录用户
        User loginUser = userService.getLoginUser(request);
        int result = userService.reexamineDiagnosis(diagnosisReexamineDTO, loginUser);
        ThrowUtils.throwIf(result<=0,ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(true);
    }

}
