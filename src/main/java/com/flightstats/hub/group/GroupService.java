package com.flightstats.hub.group;

import com.flightstats.hub.cluster.LastContentKey;
import com.flightstats.hub.dao.ChannelService;
import com.flightstats.hub.exception.ConflictException;
import com.flightstats.hub.model.ContentKey;
import com.flightstats.hub.util.ChannelNameUtils;
import com.google.common.base.Optional;
import com.google.inject.Inject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GroupService {
    private final static Logger logger = LoggerFactory.getLogger(GroupService.class);

    private final DynamoGroupDao dynamoGroupDao;
    private final GroupValidator groupValidator;
    private final GroupCallback groupCallback;
    private final LastContentKey lastContentKey;
    private ChannelService channelService;

    @Inject
    public GroupService(DynamoGroupDao dynamoGroupDao, GroupValidator groupValidator,
                        GroupCallback groupCallback, LastContentKey lastContentKey,
                        ChannelService channelService) {
        this.dynamoGroupDao = dynamoGroupDao;
        this.groupValidator = groupValidator;
        this.groupCallback = groupCallback;
        this.lastContentKey = lastContentKey;
        this.channelService = channelService;
    }

    public Optional<Group> upsertGroup(Group group) {
        logger.info("upsert group " + group);
        group = group.withDefaults();
        groupValidator.validate(group);
        Optional<Group> existingGroup = getGroup(group.getName());
        if (existingGroup.isPresent()) {
            if (existingGroup.get().equals(group)) {
                return existingGroup;
            }
            throw new ConflictException("{\"error\": \"Groups are immutable\"}");
        }
        lastContentKey.initialize(group.getName(), group.getStartingKey(), GroupCaller.GROUP_LAST_COMPLETED);
        dynamoGroupDao.upsertGroup(group);
        groupCallback.notifyWatchers();
        return existingGroup;
    }

    public Optional<Group> getGroup(String name) {
        return dynamoGroupDao.getGroup(name);
    }

    public Iterable<Group> getGroups() {
        return dynamoGroupDao.getGroups();
    }

    public GroupStatus getGroupStatus(Group group) {
        GroupStatus.GroupStatusBuilder builder = GroupStatus.builder().group(group);
        String channel = ChannelNameUtils.extractFromChannelUrl(group.getChannelUrl());
        Optional<ContentKey> lastKey = channelService.getLatest(channel, true, false);
        if (lastKey.isPresent()) {
            builder.channelLatest(lastKey.get());
        }
        groupCallback.getStatus(group, builder);
        return builder.build();
    }

    public void delete(String name) {
        logger.info("deleting group " + name);
        dynamoGroupDao.delete(name);
        groupCallback.delete(name);
    }

}
