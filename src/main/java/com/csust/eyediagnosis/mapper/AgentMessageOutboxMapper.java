package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.agent.outbox.AgentMessageOutboxEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AgentMessageOutboxMapper extends BaseMapper<AgentMessageOutboxEntity> {

    List<AgentMessageOutboxEntity> selectPending(@Param("limit") int limit);

    void markDelivered(@Param("id") Long id);

    void markRetry(@Param("id") Long id, @Param("error") String error);

    void markDead(@Param("id") Long id, @Param("error") String error);
}
