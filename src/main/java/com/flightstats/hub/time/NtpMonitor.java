package com.flightstats.hub.time;


import com.flightstats.hub.app.HubProperties;
import com.flightstats.hub.app.HubServices;
import com.flightstats.hub.metrics.DataDog;
import com.flightstats.hub.metrics.MetricsSender;
import com.google.common.util.concurrent.AbstractScheduledService;
import com.google.inject.Inject;
import com.google.inject.Singleton;
import com.timgroup.statsd.StatsDClient;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Singleton
public class NtpMonitor {
    private final static StatsDClient statsd = DataDog.statsd;

    private final static Logger logger = LoggerFactory.getLogger(NtpMonitor.class);
    private final int minPostTimeMillis = HubProperties.getProperty("app.minPostTimeMillis", 5);
    private final int maxPostTimeMillis = HubProperties.getProperty("app.maxPostTimeMillis", 1000);
    @Inject
    private MetricsSender sender;
    private double primaryOffset;

    public NtpMonitor() {
        if (HubProperties.getProperty("app.runNtpMonitor", true)) {
            HubServices.register(new TimeMonitorService(), HubServices.TYPE.PRE_START);
        } else {
            logger.info("not running NtpMonitor");
        }
    }

    static double parseClusterRange(List<String> lines) {
        double maxPositive = 0;
        double maxNegative = 0;
        for (int i = 4; i < lines.size(); i++) {
            String line = lines.get(i);
            double offset = parseLine(line);
            if (offset > 0) {
                maxPositive = Math.max(maxPositive, offset);
            } else {
                maxNegative = Math.max(maxNegative, Math.abs(offset));
            }
        }
        return maxNegative + maxPositive;
    }

    static double parsePrimary(List<String> lines) {
        List<Double> servers = new ArrayList<>();
        for (int i = 2; i <= Math.min(3, lines.size() - 1); i++) {
            String line = lines.get(i);
            if (line.startsWith("*") || line.startsWith("+")) {
                double primary = parseLine(line);
                logger.info("primary {}", primary);
                servers.add(primary);
            }
        }
        return servers.stream().mapToDouble(d -> d).average().getAsDouble();
    }

    private static double parseLine(String line) {
        String[] split = StringUtils.split(line, " ");
        return Double.parseDouble(split[split.length - 2]);
    }

    private void run() {
        try {
            Process process = new ProcessBuilder("ntpq", "-p").start();
            List<String> lines = IOUtils.readLines(process.getInputStream());
            double delta = parseClusterRange(lines);
            statsd.gauge("ntp", delta, "ntpType:clusterTimeDelta");
            sender.send("clusterTimeDelta", delta);
            double primary = parsePrimary(lines);
            primaryOffset = Math.abs(primary);
            statsd.gauge("ntp", primaryOffset, "ntpType:primaryTimeDelta");
            sender.send("primaryTimeDelta", primaryOffset);
            logger.info("ntp cluster {} primary {}", delta, primary);
        } catch (Exception e) {
            logger.info("unable to exec", e);
        }
    }

    public int getPostTimeBuffer() {
        return Math.min(maxPostTimeMillis, (int) (minPostTimeMillis + primaryOffset));
    }


    private class TimeMonitorService extends AbstractScheduledService {
        @Override
        protected void runOneIteration() throws Exception {
            run();
        }

        @Override
        protected Scheduler scheduler() {
            return Scheduler.newFixedDelaySchedule(0, 1, TimeUnit.MINUTES);
        }
    }
}
