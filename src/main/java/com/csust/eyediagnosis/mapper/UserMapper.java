package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.User;
import org.apache.ibatis.annotations.Param;

/**
* @author 钰玟
* @description 针对表【t_user(用户)】的数据库操作Mapper
* @createDate 2025-04-12 15:23:32
* @Entity com.csust.eyediagnosis.model.entity.User
*/
public interface UserMapper extends BaseMapper<User> {

    User selectUserNameAndUserAvatarByUserId(@Param("userId") Long userId);
}




