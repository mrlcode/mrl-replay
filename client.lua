local PendingRequests = {}
local UploadTimeout = 30000
local ResponseTimeout = 33000

local function finishRequest(Id, Url, Error, Seconds)
    if not PendingRequests[Id] then return end
    PendingRequests[Id] = nil

    TriggerServerEvent("mrl-replay:saved", Url, Error, Id, Seconds)
end

RegisterNetEvent("mrl-replay:save", function(Webhook, Id)
    if type(Id) ~= "string" or Id == "" or PendingRequests[Id] then
        return
    end

    PendingRequests[Id] = true

    if type(Webhook) ~= "string" or Webhook == "" then
        finishRequest(Id, nil, "webhook nao informada")
        return
    end

    SendNUIMessage({
        action = "save",
        webhook = Webhook,
        id = Id,
        timeoutMs = UploadTimeout
    })

    SetTimeout(ResponseTimeout, function()
        finishRequest(Id, nil, "tempo limite de resposta da NUI excedido")
    end)
end)

RegisterNUICallback("saved", function(Data, Callback)
    Callback({ ok = true })

    if type(Data) ~= "table" or type(Data.id) ~= "string" then return end
    if not PendingRequests[Data.id] then return end

    local Url = type(Data.url) == "string" and Data.url ~= "" and Data.url or nil
    local Error = type(Data.error) == "string" and Data.error ~= "" and Data.error or nil
    local Seconds = tonumber(Data.seconds)

    if not Url and not Error then
        Error = "NUI retornou resposta sem URL do video"
    end

    finishRequest(Data.id, Url, Error, Seconds)
end)
