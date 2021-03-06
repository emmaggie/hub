package com.flightstats.hub.webhook;

import com.flightstats.hub.model.ContentKey;
import com.flightstats.hub.model.ContentPath;
import com.flightstats.hub.model.ContentPathKeys;
import com.flightstats.hub.model.SecondPath;
import com.flightstats.hub.util.TimeUtil;
import org.joda.time.DateTime;

import java.util.Collection;

class SecondTimedWebhook implements TimedWebhook {

    static final SecondTimedWebhook WEBHOOK = new SecondTimedWebhook();

    @Override
    public int getOffsetSeconds() {
        return 0;
    }

    @Override
    public int getPeriodSeconds() {
        return 1;
    }

    @Override
    public TimeUtil.Unit getUnit() {
        return TimeUtil.Unit.SECONDS;
    }

    @Override
    public ContentPathKeys newTime(DateTime pathTime, Collection<ContentKey> keys) {
        return new SecondPath(pathTime, keys);
    }

    @Override
    public ContentPath getNone() {
        return SecondPath.NONE;
    }

    @Override
    public DateTime getReplicatingStable(ContentPath contentPath) {
        return contentPath.getTime();
    }
}
