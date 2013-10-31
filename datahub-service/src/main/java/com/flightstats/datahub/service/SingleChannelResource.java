package com.flightstats.datahub.service;

import com.codahale.metrics.annotation.ExceptionMetered;
import com.codahale.metrics.annotation.Timed;
import com.flightstats.datahub.app.config.PATCH;
import com.flightstats.datahub.app.config.metrics.PerChannelTimed;
import com.flightstats.datahub.model.*;
import com.flightstats.rest.Linked;
import com.google.common.base.Optional;
import com.google.common.cache.Cache;
import com.google.inject.Inject;
import com.google.inject.name.Named;

import javax.ws.rs.*;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.UriInfo;
import java.net.URI;
import java.util.Date;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;

import static com.flightstats.rest.Linked.linked;

/**
 * This resource represents a single channel in the DataHub.
 */
@Path("/channel/{channelName}")
public class SingleChannelResource {

    private final DataHubService dataHubService;
    private final ChannelHypermediaLinkBuilder linkBuilder;
    private final Cache<String, Boolean> knownChannelCache;
    private final Integer maxPayloadSizeBytes;

    @Inject
    public SingleChannelResource(DataHubService dataHubService, ChannelHypermediaLinkBuilder linkBuilder,
                                 @Named("KnownChannelCache") Cache<String,Boolean> knownChannelCache,
                                 @Named("maxPayloadSizeBytes") Integer maxPayloadSizeBytes) {
        this.dataHubService = dataHubService;
        this.linkBuilder = linkBuilder;
        this.knownChannelCache = knownChannelCache;
        this.maxPayloadSizeBytes = maxPayloadSizeBytes;
    }

    @GET
    @Timed
    @ExceptionMetered
    @PerChannelTimed(operationName = "metadata", channelNamePathParameter = "channelName")
    @Produces(MediaType.APPLICATION_JSON)
    public Linked<MetadataResponse> getChannelMetadata(@PathParam("channelName") String channelName, @Context UriInfo uriInfo) {
        if (noSuchChannel(channelName)) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }

        ChannelConfiguration config = dataHubService.getChannelConfiguration(channelName);
        Date lastUpdateDate = getLastUpdateDate(channelName);
        MetadataResponse response = new MetadataResponse(config, lastUpdateDate);
        return linked(response)
                .withLink("self", linkBuilder.buildChannelUri(config, uriInfo))
                .withLink("latest", linkBuilder.buildLatestUri(uriInfo))
                .withLink("ws", linkBuilder.buildWsLinkFor(uriInfo))
                .build();
    }

    private Date getLastUpdateDate(String channelName) {
        Optional<DataHubKey> latestId = dataHubService.findLastUpdatedKey(channelName);
        if (!latestId.isPresent()) {
            return null;
        }
        return latestId.get().getDate();
    }

    @PATCH
    @Timed
    @ExceptionMetered
    @PerChannelTimed(operationName = "update", channelNamePathParameter = "channelName")
    @Produces(MediaType.APPLICATION_JSON)
    @Consumes(MediaType.APPLICATION_JSON)
    public Response updateMetadata(ChannelUpdateRequest request, @PathParam("channelName") String channelName, @Context UriInfo uriInfo) throws
            Exception {
        if (noSuchChannel(channelName)) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }

        ChannelConfiguration oldConfig = dataHubService.getChannelConfiguration(channelName);
        ChannelConfiguration.Builder builder = ChannelConfiguration.builder().withChannelConfiguration(oldConfig);
        if (request.getTtlMillis() != null) {
            builder.withTtlMillis(request.getTtlMillis().isPresent() ? request.getTtlMillis().get() : null);
        }
        ChannelConfiguration newConfig = builder.build();
        dataHubService.updateChannelMetadata(newConfig);
        URI channelUri = linkBuilder.buildChannelUri(newConfig, uriInfo);
        return Response.ok(channelUri).entity(
                linkBuilder.buildLinkedChannelConfig(newConfig, channelUri, uriInfo))
                       .build();
    }

    @POST
    @Timed(name = "all-channels.insert")
    @ExceptionMetered
    @PerChannelTimed(operationName = "insert", channelNamePathParameter = "channelName")
    @Produces(MediaType.APPLICATION_JSON)
    public Response insertValue(@PathParam("channelName") final String channelName, @HeaderParam("Content-Type") final String contentType,
                                @HeaderParam("Content-Language") final String contentLanguage,
                                final byte[] data,
                                @Context UriInfo uriInfo) throws Exception {
        if (noSuchChannel(channelName)) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }

        if (data.length > maxPayloadSizeBytes) {
            return Response.status(413).entity("Max payload size is " + maxPayloadSizeBytes + " bytes.").build();
        }

        ValueInsertionResult insertionResult = dataHubService.insert(channelName, data, Optional.fromNullable(contentType),
                Optional.fromNullable(contentLanguage));
        URI payloadUri = linkBuilder.buildItemUri(insertionResult.getKey(), uriInfo.getRequestUri());
        Linked<ValueInsertionResult> linkedResult = linked(insertionResult)
                .withLink("channel", linkBuilder.buildChannelUri(channelName, uriInfo))
                .withLink("self", payloadUri)
                .build();

        Response.ResponseBuilder builder = Response.status(Response.Status.CREATED);
        builder.entity(linkedResult);
        builder.location(payloadUri);
        return builder.build();
    }

    private boolean noSuchChannel(final String channelName) {
        try {
            return !knownChannelCache.get(channelName, new Callable<Boolean>() {
                @Override
                public Boolean call() throws Exception {
                    boolean existsOrNot = dataHubService.channelExists(channelName);
                    if (existsOrNot) {
                        return true;
                    }
                    throw new ExecutionException("Channel does not exist.", new RuntimeException());
                }
            });
        } catch (ExecutionException e) {
            return true;
        }
    }

}
