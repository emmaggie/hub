package com.flightstats.hub.alert;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flightstats.hub.app.HubProvider;
import com.flightstats.hub.channel.LinkBuilder;
import com.flightstats.hub.model.ContentKey;
import com.flightstats.hub.rest.Linked;
import com.flightstats.hub.util.TimeUtil;
import com.google.common.base.Optional;
import org.joda.time.Minutes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.ws.rs.*;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.UriInfo;
import java.net.URI;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

@SuppressWarnings("WeakerAccess")
@Path("/alert")
public class AlertResource {

    private final static Logger logger = LoggerFactory.getLogger(AlertResource.class);

    @Context
    private UriInfo uriInfo;

    private static final ObjectMapper mapper = HubProvider.getInstance(ObjectMapper.class);

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response getAlerts() {
        Collection<AlertConfig> alertConfigs = AlertConfigs.getLatest().values();
        Map<String, URI> nameUriMap = new HashMap<>();
        for (AlertConfig alertConfig : alertConfigs) {
            String name = alertConfig.getName();
            nameUriMap.put(name, URI.create(uriInfo.getBaseUri() + "alert/" + name));
        }
        Linked<?> result = LinkBuilder.buildLinks(nameUriMap, "alerts", builder -> {
            builder.withLink("self", uriInfo.getRequestUri());
            builder.withRelativeLink("health", uriInfo);
        });
        return Response.ok(result).build();
    }

    @GET
    @Path("/{name}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getAlert(@PathParam("name") String name) {
        Map<String, AlertConfig> alertConfigs = AlertConfigs.getLatest();
        if (alertConfigs.containsKey(name)) {
            AlertConfig alertConfig = alertConfigs.get(name);
            return getResponse(alertConfig, 200);
        }
        return Response.status(Response.Status.NOT_FOUND).build();
    }

    private Response getResponse(AlertConfig alertConfig, int status) {
        Linked linked = Linked.justLinks()
                .withLink("self", uriInfo.getRequestUri())
                .withRelativeLink("status", uriInfo)
                .build();
        ObjectNode node = mapper.createObjectNode();
        alertConfig.writeJson(node);
        linked.writeJson(node);
        return Response.status(status).entity(node.toString()).build();
    }

    @PUT
    @Path("/{name}")
    @Produces(MediaType.APPLICATION_JSON)
    @Consumes(MediaType.APPLICATION_JSON)
    public Response putAlert(@PathParam("name") String name, String body) {
        AlertConfig alertConfig = AlertConfig.fromJson(name, body);
        AlertConfigs.upsert(alertConfig);
        return getResponse(alertConfig, 201);
    }

    @DELETE
    @Path("/{name}")
    public Response deleteAlert(@PathParam("name") String name) {
        AlertConfigs.delete(name);
        return Response.status(202).build();
    }

    @GET
    @Path("/health")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getHealth() {
        Optional<ContentKey> latestKey = AlertStatuses.getLatestKey();
        logger.debug("latest key {}", latestKey);
        ObjectNode objectNode = mapper.createObjectNode();
        if (latestKey.isPresent()) {
            ContentKey key = latestKey.get();
            objectNode.put("latestStatusKey", key.toString());
            int minutes = Minutes.minutesBetween(key.getTime(), TimeUtil.now()).getMinutes();
            objectNode.put("statusOffsetMinutes", minutes);
            if (minutes <= 2) {
                return Response.ok(objectNode.toString()).build();
            }
        } else {
            objectNode.put("latestStatusKey", "none");
        }
        return Response.status(500).entity(objectNode.toString()).build();
    }

    @GET
    @Path("/{name}/status")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getAlertStatus(@PathParam("name") String name) {
        Map<String, AlertStatus> alertStatusMap = AlertStatuses.getLatestMap();
        if (alertStatusMap.containsKey(name)) {
            Linked linked = Linked.linked(alertStatusMap.get(name))
                    .withLink("self", uriInfo.getRequestUri())
                    .build();
            return Response.status(200).entity(linked).build();
        }
        return Response.status(Response.Status.NOT_FOUND).build();
    }

}
