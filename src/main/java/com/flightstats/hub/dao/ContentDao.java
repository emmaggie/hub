package com.flightstats.hub.dao;

import com.flightstats.hub.model.*;
import com.flightstats.hub.util.TimeUtil;
import com.google.common.base.Optional;
import org.joda.time.DateTime;

import java.util.List;
import java.util.SortedSet;

public interface ContentDao {

    String CACHE = "Cache";
    String LONG_TERM = "LongTerm";
    String BATCH_LONG_TERM = "BatchLongTerm";

    ContentKey write(String channelName, Content content) throws Exception;

    Content read(String channelName, ContentKey key);

    SortedSet<ContentKey> queryByTime(String channelName, DateTime startTime, TimeUtil.Unit unit, Traces traces);

    SortedSet<ContentKey> query(DirectionQuery query);

    void delete(String channelName);

    void initialize();

    Optional<ContentKey> getLatest(String channel, ContentKey limitKey, Traces traces);

    void deleteBefore(String channelName, ContentKey limitKey);

    default void writeBatch(String channel, MinutePath path, List<ContentKey> keys, byte[] bytes) {
        throw new UnsupportedOperationException("writeBatch is not supported");
    }

    //todo - gfm - 10/23/15 - add batch read
}
