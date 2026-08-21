# Roadmap

Where the port stands, and what's been discussed for later. See [CREDITS.md](CREDITS.md)
for attribution and [README.md](README.md) for usage.

## Concluído (v0.1.0 → v0.2.6)

### Núcleo do módulo
- Geometria do hexágono, zonas de terreno misto e pontos de âncora de estrada/rio
  portados 1:1 do Python original (`scripts/geometry.js`).
- Fronteira de zona por cancelamento combinatório de arestas, sem dependência de
  lib de geometria (`scripts/zone-cluster.js`) - inclui o caso de zona com "buraco"
  (`test_files/test-zone-with-hole.yaml`).
- Camada interativa no canvas (`HexChronicleLayer`) com 5 ferramentas: Editar,
  Revelar/Ocultar Terreno, Revelar/Ocultar Estrutura, Abrir Link, Importar Arquivos.
- Editor de hexágono em ApplicationV2 (terreno, terreno misto, ícone, label,
  estradas, rios, zonas, link).
- Import em lote dos formatos originais `.md` (frontmatter) e `.yaml`/`.yml`,
  com `js-yaml` vendorizado.
- Fog-of-war em duas camadas: exploração de terreno e revelação de estrutura,
  independentes uma da outra - um hexágono pode ter o terreno conhecido sem que
  a estrutura (ícone/label/link) já tenha sido descoberta. Sigilo é "suave"
  (client-side), compartilhado por todo o grupo. Revelação manual (ferramentas
  dedicadas) e automática (movimento de token, com raio configurável).
- Vínculo de hexágono com Journal Entry/página/Scene ("Open Link"), com
  arrastar-e-soltar da sidebar, respeitando as permissões normais do Foundry.
- Workflow de release no GitHub Actions: tag `vX.Y.Z` empacota o módulo e
  carimba `version`/`manifest`/`download` automaticamente.

### Bugs encontrados e corrigidos via teste ao vivo (Foundry v13)
- ApplicationV2 exige que cada "part" do template renderize um único elemento
  raiz - o formulário do editor tinha vários irmãos soltos e quebrava ao abrir.
- Um `InteractionLayer` puro (diferente de `PlaceablesLayer`) nunca ativava a
  camada sozinho ao trocar de controle na barra de ferramentas - corrigido com
  um hook em `renderSceneControls`.
- `ui.controls.activeTool` está deprecated (removido na v16) - trocado por
  `ui.controls.tool.name`.
- Uma textura de ícone ausente/malformada podia derrubar a renderização do
  mapa inteiro (`new PIXI.Sprite` quebrando) - agora a textura é validada
  antes de virar sprite, com fallback pro label em vez de crash.
- Cena sem nenhum hexágono cadastrado não desenhava nada, nem uma grade vazia
  pra clicar - agora desenha uma grade inicial de 3 anéis, centralizada no
  centro da cena (não em (0,0) do mundo, que fica longe da câmera padrão).
- A camada ficava permanentemente interativa (`eventMode` nunca desligava),
  então qualquer clique com qualquer ferramenta de qualquer grupo mexia no
  hexágono - corrigido com `_activate()`/`_deactivate()` ligando/desligando a
  interatividade conforme o controle selecionado, mais uma checagem explícita
  `tool === "edit"` no lugar de um fallback genérico.
- O dropdown de "Terreno" usava `{{selectOptions}}` com um array simples, e o
  Foundry usa o **índice do array** como valor salvo nesse caso - escolher
  "heavy_woods" salvava `"2"`. Corrigido passando um objeto chave→valor.

### Visual
- Paleta de terreno trocada de cores "clipart" saturadas por tons mais
  naturais/suaves (mesmo mapeamento semântico).
- Grade mais fina e translúcida, números de coordenada menores e discretos.
- Formulário do editor reorganizado em seções (`fieldset`) com ícones:
  Terreno, Estrutura, Estradas & Rios, Zonas & Links.

## Em aberto / próximos passos

Nenhum destes tem prazo definido - são ideias discutidas, priorizadas
aproximadamente por esforço/impacto.

### Ganhos rápidos
- **Destaque do hexágono sob o cursor** ao passar o mouse, pra saber qual vai
  abrir antes de clicar.
- **Botão de resetar fog** exposto na interface - a função `resetFog()` já
  existe em `fog.js` mas não está ligada a nenhum botão/ferramenta ainda.
- **Seletor visual de ícone** com preview (em vez de digitar o nome do arquivo
  de cor).

### Mudança de maior impacto
- **Editor visual de terreno misto/estradas/rios**: um mini-diagrama clicável
  do hexágono (as 7 zonas + pontos cardeais) no lugar da sintaxe de texto
  atual (`lake: C`, `SW SE`).

### Para mapas grandes
- **Buscar/ir para hexágono por coordenada.**
- **Legenda de terreno/zona** visível na tela.

### Para overlay em arte customizada
- **Alça de arrastar** pra reposicionar/escalar a grade visualmente sobre uma
  imagem de fundo, em vez de digitar offset/raio nas configurações.

## Limitações conhecidas (decisões deliberadas, não bugs)

- **Sigilo é "suave", não real**: o conteúdo de hexágonos não explorados
  continua presente no client de qualquer jogador com acesso à cena (é assim
  que flags do Foundry funcionam). Um jogador que abrir o console do
  navegador consegue ler os dados brutos. Sigilo "forte" (autoritativo via
  socket do GM) ficaria para uma versão futura, se for realmente necessário.
- **Revelação automática depende do client do GM estar conectado** - é ele
  quem escreve a flag de exploração.
- **A ferramenta "Ver Hexágono" (não-GM) ainda não faz nada** - clicar não
  abre nenhuma visualização somente-leitura. Pendente desde o início do
  port, baixa prioridade.
- Zonas (fronteiras tracejadas) só aparecem pro GM - podem revelar a forma de
  uma área secreta antes da hora, e não há um "desconhecido" equivalente pra
  esconder isso de jogadores.
