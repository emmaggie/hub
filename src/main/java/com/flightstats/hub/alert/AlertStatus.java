package com.flightstats.hub.alert;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import lombok.*;

import java.lang.reflect.Type;
import java.util.LinkedList;
import java.util.Map;

@Builder
@Getter
@Setter
@ToString
@EqualsAndHashCode
public class AlertStatus {

    private static final Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    public static final String MINUTE = "minute";
    public static final String HOUR = "hour";

    private String name;
    private String period;
    private boolean alert;
    private String type;
    private LinkedList<AlertStatusHistory> history = new LinkedList<>();

    public static Map<String, AlertStatus> fromJson(String json) {
        Type mapType = new TypeToken<Map<String, AlertStatus>>() {
        }.getType();

        return gson.fromJson(json, mapType);
    }

    public static String toJson(Map<String, AlertStatus> map) {
        return gson.toJson(map);
    }

    public String toJson() {
        return gson.toJson(this);
    }
}
