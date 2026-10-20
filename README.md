# MRL Replay

Sistema de replay para **FiveM (GTA V)**. Mantém um buffer de vídeo da tela do jogador, envia o clipe para uma webhook do Discord quando solicitado pelo servidor e retorna a URL para integração com outros resources.

O fluxo principal usa Lua no servidor e no client, com captura e upload pela NUI em JavaScript. Não exige comando do jogador nem abre uma interface de gravação.

## Demonstração

### Exemplo 1 — Gravação normal e replay

**Gravação normal**

https://github.com/user-attachments/assets/ab1df390-8356-4fae-b392-d7d169ab6ba9

**Sistema de replay**

https://github.com/user-attachments/assets/26424310-bfac-4de4-89b0-2da835c4a575

### Exemplo 2 — Gravação normal e replay

**Gravação normal**

https://github.com/user-attachments/assets/c52376db-616f-4c94-aa65-c0d4dcfe80e9

**Sistema de replay**

https://github.com/user-attachments/assets/115251a8-13a2-4139-b210-b54b0a57822e

### Exemplo 3 — Visibilidade de interfaces de cheats internos

Alguns cheats internos também podem ter suas interfaces visíveis no replay quando elas são desenhadas na imagem do jogo capturada pelo sistema. Isso depende de como a interface é renderizada: aparecer na tela do jogador, por si só, não garante que ela seja incluída na captura.

**Sistema de replay**

https://github.com/user-attachments/assets/42a56532-3656-4c72-9c82-ed46372b79c8

## Recursos

- Gravação contínua da imagem do jogo enquanto a NUI está ativa.
- Upload de clipes em `.webm` para o Discord.
- Export server-side `saveClip`, com URL, erro e duração como retorno.
- Identificação individual de solicitações e suporte a pedidos simultâneos.
- Reutilização da mesma captura para solicitações que compartilham um upload ativo.
- Tratamento de falhas de upload, timeout e desconexão do jogador.
- Client Lua aberto e legível.

## Como funciona

1. A NUI inicia a captura automaticamente quando o resource carrega no client.
2. Um resource do servidor chama `saveClip` com a source do jogador e a webhook de destino.
3. O servidor solicita o clipe ao client pelo evento `mrl-replay:save`.
4. O client encaminha a solicitação à NUI, que finaliza uma gravação do buffer e envia o vídeo ao Discord.
5. O callback NUI `saved` entrega o resultado ao client, que responde ao servidor por `mrl-replay:saved`.
6. O export retorna a URL do vídeo ou uma mensagem de erro.

A captura atual contém **somente vídeo**, sem áudio. O vídeo é enviado diretamente pelo computador do jogador; não é salvo em disco pelo servidor.

## Instalação

1. Coloque a pasta `mrl-replay` dentro de `resources` do servidor.
2. Mantenha as pastas `web` e `module` junto dos arquivos Lua.
3. Adicione ao `server.cfg`, antes dos resources que vão usar o export:

   ```cfg
   ensure mrl-replay
   ```

4. Configure uma webhook do Discord no seu resource de integração.

## Uso em outro resource

O export é **server-side** e aguarda o resultado de forma assíncrona. Chame-o dentro de uma thread ou de um contexto que permita espera.

```lua
-- server.lua do seu resource
local ReplayWebhook = GetConvar('replay_webhook', '')

local function solicitarReplay(playerSource)
    CreateThread(function()
        local url, err, seconds = exports['mrl-replay']:saveClip(
            playerSource,
            ReplayWebhook
        )

        if not url then
            print(('[Replay] Falha: %s'):format(err or 'erro desconhecido'))
            return
        end

        print(('[Replay] Clipe de %ss: %s'):format(seconds or '?', url))
        -- Salve a URL no seu sistema de logs ou vincule-a ao atendimento.
    end)
end

-- Chame solicitarReplay(sourceDoJogador) no fluxo do seu sistema.
```

Configure a convar no `server.cfg` com `set` para leitura no servidor:

```cfg
set replay_webhook "https://discord.com/api/webhooks/SEU_ID/SEU_TOKEN"
```

No manifesto do resource que integra o replay, você também pode declarar:

```lua
dependency 'mrl-replay'
```

### Assinatura do export

```lua
local url, err, seconds = exports['mrl-replay']:saveClip(playerSource, webhook)
```

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `playerSource` | number | Source de um jogador conectado. |
| `webhook` | string | URL HTTPS da webhook que receberá o vídeo. |
| `url` | string ou nil | URL do anexo retornada pelo Discord em caso de sucesso. |
| `err` | string ou nil | Descrição da falha. |
| `seconds` | number ou nil | Duração aproximada do vídeo enviado. |

Use o export como ponto de entrada da integração: ele registra a solicitação e correlaciona a resposta do client.

## Exemplo de integração com EQPG ANTI CHEAT

No server-side do seu resource de integração, use `AddEventHandler` para escutar o evento `EQPG:suspeitos`. O handler recebe a source do jogador, o motivo da detecção e o token de identificação do EQPG. A solicitação de replay é executada em uma thread para aguardar o retorno do export.

**O Discord recebe somente o vídeo.** A source, o motivo e o token são exibidos apenas no console do servidor neste exemplo.

```lua
local Webhooks = {
    ['[aimbot]'] = 'https://discord.com/api/webhooks/ID_AIMBOT/TOKEN_AIMBOT',
    ['default'] = 'https://discord.com/api/webhooks/ID_GERAL/TOKEN_GERAL'
}

AddEventHandler('EQPG:suspeitos', function(playerSource, reason, token)
    playerSource = tonumber(playerSource)
    reason = tostring(reason or ''):gsub('^%s+', ''):gsub('%s+$', '')

    if not playerSource or not GetPlayerName(playerSource) or reason == '' then
        return
    end

    local webhook = Webhooks[reason:lower()] or Webhooks['default']

    CreateThread(function()
        local url, err, seconds = exports['mrl-replay']:saveClip(
            playerSource,
            webhook
        )

        if not url then
            print(('[Replay] Source %s | Motivo %s | Erro: %s'):format(
                playerSource, reason, err or 'erro desconhecido'
            ))
            return
        end

        print(('[Replay] Source %s | EQPG %s | Motivo %s | %ss | %s'):format(
            playerSource, tostring(token or ''), reason, seconds or '?', url
        ))
    end)
end)
```

Substitua os placeholders pelas suas webhooks. A tabela `Webhooks` separa o destino por motivo: a seleção é por correspondência exata. Neste exemplo, somente `[aimbot]` usa a webhook específica; `[aimbot-1]`, `[aimbot-2]` e qualquer outro motivo sem uma chave própria usam `default`. Adicione outras chaves com os motivos emitidos pelo seu EQPG para encaminhá-los a canais diferentes. As chaves devem estar em minúsculas, pois a consulta usa `reason:lower()`.

O handler acompanha um evento do servidor por `AddEventHandler`, sem registrá-lo como evento de rede.

## Teste pelo console

Execute no console do servidor, com um jogador conectado:

```text
replaysave [source] [webhook]
```

Substitua os argumentos pela source e pela URL completa da webhook. O comando só atende chamadas do console do servidor e imprime a URL ou o erro ao terminar.

Aguarde cerca de 10 segundos após a inicialização do resource no client para o primeiro teste. Se o buffer ainda estiver acumulando, a NUI aguarda a gravação ficar disponível dentro do prazo da solicitação.

## Configuração da gravação

Edite `recordingConfig` em `web/app.js`:

```js
const recordingConfig = {
    width: 854,
    height: 480,
    fps: 30,
    bitrate: 900000,
    clipSeconds: 10
};
```

| Opção | Função |
| --- | --- |
| `width` / `height` | Resolução de captura. |
| `fps` | Taxa solicitada ao stream do canvas. |
| `bitrate` | Bitrate solicitado ao encoder, em bits por segundo. |
| `clipSeconds` | Janela mínima de gravação usada para selecionar um clipe. |

A implementação mantém gravações sobrepostas. Com `clipSeconds: 10`, o clipe normalmente contém aproximadamente **10 a 20 segundos**, dependendo do momento da solicitação. Não existe recorte exato dos últimos 10 segundos. Pedidos próximos podem precisar aguardar a recomposição do buffer.

Aumentar resolução, FPS, bitrate ou duração pode aumentar o uso de CPU/GPU, memória, tamanho do arquivo e tempo de envio. Reinicie o resource após alterar a configuração.

### Prazos atuais

- NUI: 30 segundos para a sessão de captura/upload.
- Client Lua: 33 segundos para receber o resultado da NUI.
- Servidor: 35 segundos para resolver a solicitação.

Ao alterar esses valores, mantenha margem para o resultado chegar ao servidor. O tempo de captura e upload precisa caber no prazo total.

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| `player invalido` | Confirme se a source corresponde a um jogador conectado. |
| `webhook invalida` | Confira a URL HTTPS e o caminho `/api/webhooks/ID/TOKEN`. |
| `Discord HTTP ...` | Leia o detalhe retornado: a webhook, o tamanho do arquivo ou o limite de requisições podem impedir o envio. |
| Timeout da NUI ou do servidor | Verifique erros no F8/NUI, conexão do client e tempo necessário para upload. |
| Falha ao carregar o resource | Confira o nome da pasta `mrl-replay`, os arquivos do resource, o `fxmanifest.lua` e os erros no console. |
| Primeiro clipe demora | O buffer precisa acumular vídeo antes da captura. |

## Limites e uso em produção

A captura e a resposta são executadas no client. O sistema não garante a autenticidade do vídeo ou dos dados retornados por um client modificado; considere isso ao integrá-lo a ferramentas de moderação.

A webhook de upload é encaminhada ao client para realizar o envio, portanto não deve ser tratada como um segredo exclusivo do servidor. Use uma webhook dedicada ao replay. O sistema grava a imagem do jogo: informe os jogadores sobre essa funcionalidade nas regras e políticas do seu servidor.

O cancelamento de uma sessão de upload na NUI afeta os pedidos que compartilham essa sessão. A URL retornada é a URL fornecida pelo Discord, sem garantia de armazenamento permanente pelo resource.

## Licença e créditos

Autoria: [mrlcode](https://github.com/mrlcode).

O código próprio do MRL Replay está disponível sob a [licença MIT](LICENSE), permitindo uso, modificação e redistribuição com a manutenção do aviso de copyright e da licença.

As dependências incluídas, como o Three.js em `module/`, mantêm suas respectivas licenças e créditos. A licença do projeto não substitui os termos dessas dependências.
