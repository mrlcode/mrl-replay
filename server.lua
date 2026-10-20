local Sessions = {}
local RequestId = 0
local RequestTimeout = 35000

local function nextRequestId(Source)
    RequestId = RequestId + 1
    return ("%s:%s:%s"):format(Source, os.time(), RequestId)
end

local function createSession(Source)
    local Session = Sessions[Source]

    if Session then
        return Session
    end

    Session = {
        requests = {},
        requestIds = {},
        requestCount = 0
    }

    Sessions[Source] = Session
    return Session
end

local function cleanupSession(Source)
    local Session = Sessions[Source]
    if not Session or Session.requestCount > 0 then return end

    Sessions[Source] = nil
end

local function removeRequestId(Session, Id)
    for i = 1, #Session.requestIds do
        if Session.requestIds[i] == Id then
            table.remove(Session.requestIds, i)
            return
        end
    end
end

local function resolveRequest(Source, Id, Result)
    local Session = Sessions[Source]
    if not Session then return false end

    local Request = Session.requests[Id]
    if not Request then return false end

    Session.requests[Id] = nil
    Session.requestCount = Session.requestCount - 1

    removeRequestId(Session, Id)
    Request.response:resolve(Result)
    cleanupSession(Source)

    return true
end

local function dispatchRequest(Source, Request)
    TriggerClientEvent("mrl-replay:save", Source, Request.webhook, Request.id)
end

function saveClip(Source, Webhook)
    Source = tonumber(Source)

    if not Source or Source <= 0 or not GetPlayerName(Source) then
        return nil, "player invalido"
    end

    if type(Webhook) ~= "string" or not Webhook:match("^https://[^/]+/api/webhooks/%d+/[^/%s%?]+") then
        return nil, "webhook invalida"
    end

    local Response = promise.new()
    local Session = createSession(Source)
    local Id = nextRequestId(Source)

    Session.requests[Id] = {
        response = Response,
        webhook = Webhook
    }

    Session.requestCount = Session.requestCount + 1
    Session.requestIds[#Session.requestIds + 1] = Id

    dispatchRequest(Source, {
        id = Id,
        webhook = Webhook
    })

    SetTimeout(RequestTimeout, function()
        resolveRequest(Source, Id, {
            error = "tempo limite excedido"
        })
    end)

    local Result = Citizen.Await(Response)
    return Result.url, Result.error, Result.seconds
end

RegisterNetEvent("mrl-replay:saved", function(Url, Error, Id, Seconds)
    local Source = source

    if type(Id) ~= "string" or Id == "" then return end

    resolveRequest(Source, Id, {
        url = Url,
        error = Error,
        seconds = tonumber(Seconds)
    })
end)

AddEventHandler("playerDropped", function()
    local Source = source
    local Session = Sessions[Source]

    if not Session then return end

    local PendingIds = {}

    for i = 1, #Session.requestIds do
        PendingIds[i] = Session.requestIds[i]
    end

    for i = 1, #PendingIds do
        resolveRequest(Source, PendingIds[i], {
            error = "player desconectou"
        })
    end

    Sessions[Source] = nil
end)

exports("saveClip", saveClip)

RegisterCommand("replaysave", function(CommandSource, Args)
    if CommandSource ~= 0 then return end

    local Source = tonumber(Args[1])
    local Webhook = Args[2]

    if not Source or not GetPlayerName(Source) or not Webhook then
        print("^3[REPLAY]^7 Uso: replaysave [source] [webhook]")
        return
    end

    CreateThread(function()
        print(("^3[REPLAY]^7 Salvando replay da source ^5%s^7..."):format(Source))

        local Url, Error, Seconds = saveClip(Source, Webhook)

        if not Url then
            print(("^1[REPLAY]^7 Falha ao salvar replay | Source: ^5%s^7 | Erro: ^1%s^7"):format(Source, Error or "erro desconhecido"))
            return
        end

        print(("^2[REPLAY]^7 Replay salvo | Source: ^5%s^7 | Duração: ^3%ss^7 | URL: %s"):format(Source, Seconds or "?", Url))
    end)
end, false)