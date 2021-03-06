package com.flightstats.hub.channel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flightstats.hub.metrics.ActiveTraces;
import com.flightstats.hub.model.ChannelConfig;
import com.flightstats.hub.model.ChannelContentKey;
import com.flightstats.hub.model.ContentKey;
import com.flightstats.hub.model.DirectionQuery;
import com.flightstats.hub.rest.HalLink;
import com.flightstats.hub.rest.Linked;
import com.google.common.base.Optional;

import javax.ws.rs.core.Response;
import javax.ws.rs.core.UriBuilder;
import javax.ws.rs.core.UriInfo;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static com.flightstats.hub.rest.Linked.linked;

public class LinkBuilder {

    private static URI buildWsLinkFor(URI channelUri) {
        String requestUri = channelUri.toString().replaceFirst("^http", "ws");
        return URI.create(requestUri + "/ws");
    }

    static void addOptionalHeader(String headerName, Optional<String> headerValue, Response.ResponseBuilder builder) {
        if (headerValue.isPresent()) {
            builder.header(headerName, headerValue.get());
        }
    }

    static URI buildChannelUri(ChannelConfig channelConfig, UriInfo uriInfo) {
        return buildChannelUri(channelConfig.getName(), uriInfo);
    }

    static URI buildChannelUri(String channelName, UriInfo uriInfo) {
        return URI.create(uriInfo.getBaseUri() + "channel/" + channelName);
    }

    public static URI buildItemUri(ContentKey key, URI channelUri) {
        return buildItemUri(key.toUrl(), channelUri);
    }

    private static URI buildItemUri(String key, URI channelUri) {
        return URI.create(channelUri.toString() + "/" + key);
    }

    static Linked<ChannelConfig> buildChannelLinks(ChannelConfig config, URI channelUri) {
        Linked.Builder<ChannelConfig> linked = linked(config).withLink("self", channelUri);
        linked.withLink("latest", URI.create(channelUri + "/latest"))
                .withLink("earliest", URI.create(channelUri + "/earliest"))
                .withLink("bulk", URI.create(channelUri + "/bulk"))
                .withLink("ws", buildWsLinkFor(channelUri))
                .withLink("events", URI.create(channelUri + "/events"))
                .withLink("time", URI.create(channelUri + "/time"))
                .withLink("status", URI.create(channelUri + "/status"));
        return linked.build();
    }

    static Linked<?> buildLinks(UriInfo uriInfo, Map<String, URI> nameToUriMap, String name) {
        return buildLinks(nameToUriMap, name, builder -> {
            builder.withLink("self", uriInfo.getRequestUri());
        });
    }

    public static Linked<?> buildLinks(Map<String, URI> nameToUriMap, String name, Consumer<Linked.Builder> consumer) {
        Linked.Builder responseBuilder = Linked.justLinks();
        consumer.accept(responseBuilder);
        List<HalLink> halLinks = new ArrayList<>(nameToUriMap.size());
        for (Map.Entry<String, URI> entry : nameToUriMap.entrySet()) {
            HalLink link = new HalLink(entry.getKey(), entry.getValue());
            halLinks.add(link);
        }
        responseBuilder.withLinks(name, halLinks);
        return responseBuilder.build();
    }

    static UriBuilder uriBuilder(String channel, UriInfo uriInfo) {
        UriBuilder uriBuilder = uriInfo.getBaseUriBuilder()
                .path("channel").path(channel);
        TimeLinkUtil.addQueryParams(uriInfo, uriBuilder);
        return uriBuilder;
    }

    static URI getDirection(String name, String channel, UriInfo uriInfo, ContentKey key, int count) {
        return LinkBuilder.uriBuilder(channel, uriInfo)
                .path(key.toUrl())
                .path(name).path("" + count)
                .build();
    }

    static Response directionalResponse(String channel, Collection<ContentKey> keys, int count,
                                        DirectionQuery query, ObjectMapper mapper, UriInfo uriInfo,
                                        boolean includePrevious, boolean trace) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode links = root.putObject("_links");
        ObjectNode self = links.putObject("self");
        self.put("href", uriInfo.getRequestUri().toString());
        List<ContentKey> list = new ArrayList<>(keys);
        String baseUri = uriInfo.getBaseUri() + "channel/" + channel + "/";
        if (list.isEmpty()) {
            ContentKey contentKey = query.getContentKey();
            if (query.isNext()) {
                ObjectNode previous = links.putObject("previous");
                previous.put("href", LinkBuilder.getDirection("previous", channel, uriInfo, contentKey, count).toString());
            } else {
                ObjectNode next = links.putObject("next");
                next.put("href", LinkBuilder.getDirection("next", channel, uriInfo, contentKey, count).toString());
            }
        } else {
            ObjectNode next = links.putObject("next");
            next.put("href", LinkBuilder.getDirection("next", channel, uriInfo, list.get(list.size() - 1), count).toString());
            if (includePrevious) {
                ObjectNode previous = links.putObject("previous");
                previous.put("href", LinkBuilder.getDirection("previous", channel, uriInfo, list.get(0), count).toString());
            }
        }
        ArrayNode ids = links.putArray("uris");
        URI channelUri = buildChannelUri(channel, uriInfo);
        for (ContentKey key : keys) {
            URI uri = buildItemUri(key, channelUri);
            ids.add(uri.toString());
        }
        if (trace) {
            ActiveTraces.getLocal().output(root);
        }
        return Response.ok(root).build();
    }

    static Response directionalTagResponse(String tag, Collection<ChannelContentKey> keys, int count,
                                           DirectionQuery query, ObjectMapper mapper, UriInfo uriInfo,
                                           boolean includePrevious, boolean trace) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode links = root.putObject("_links");
        ObjectNode self = links.putObject("self");
        self.put("href", uriInfo.getRequestUri().toString());
        List<ChannelContentKey> list = new ArrayList<>(keys);
        String baseUri = uriInfo.getBaseUri() + "tag/" + tag + "/";
        if (list.isEmpty()) {
            if (query.isNext()) {
                ObjectNode previous = links.putObject("previous");
                previous.put("href", baseUri + query.getContentKey().toUrl() + "/previous/" + count);
            } else {
                ObjectNode next = links.putObject("next");
                next.put("href", baseUri + query.getContentKey().toUrl() + "/next/" + count);
            }
        } else {
            ObjectNode next = links.putObject("next");
            next.put("href", baseUri + list.get(list.size() - 1).getContentKey().toUrl() + "/next/" + count);
            if (includePrevious) {
                ObjectNode previous = links.putObject("previous");
                previous.put("href", baseUri + list.get(0).getContentKey().toUrl() + "/previous/" + count);
            }
        }
        ArrayNode ids = links.putArray("uris");
        for (ChannelContentKey key : keys) {
            ids.add(uriInfo.getBaseUri() + key.toUrl() + "?tag=" + tag);
        }
        if (trace) {
            ActiveTraces.getLocal().output(root);
        }
        return Response.ok(root).build();
    }

    public static void addLink(String name, String href, ObjectNode node) {
        ObjectNode links = (ObjectNode) node.get("_links");
        if (links == null) {
            links = node.putObject("_links");
        }
        ObjectNode self = links.putObject(name);
        self.put("href", href);
    }

}
