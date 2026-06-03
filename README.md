# Het Boerderijwinkeltje - Zuivellogboek Server

Deze map bevat de eerste serverversie van het zuivellogboek.

## Wat zit erin?

- Logboeken opslaan, openen, zoeken, filteren en verwijderen.
- Duidelijke status voor nieuw concept, niet opgeslagen en opgeslagen op server.
- Waarschuwingen voor belangrijke velden die nog leeg zijn.
- Mobielvriendelijke bediening met wegschuivende header en snelle onderbalk.
- Backup downloaden als JSON en overzicht downloaden als CSV.
- Betere PDF-weergave via de knop "Opslaan als PDF".
- Loginbescherming voor gebruik op internet.
- Render-configuratie met persistent disk.

## Online zetten

Deze map is voorbereid voor Render. Zie:

```text
DEPLOY_RENDER.md
```

Voor online gebruik moet je in Render minimaal deze geheime instelling invullen:

```text
LOGBOOK_PASSWORD=<jouw wachtwoord>
```

De meegeleverde `render.yaml` gebruikt een persistent disk op:

```text
/var/data
```

## Starten op Windows

Dubbelklik op:

```text
start-server.bat
```

Of open PowerShell in deze map en start:

```powershell
node server.js
```

Open daarna op dezelfde computer:

```text
http://127.0.0.1:8787/
```

De server toont in PowerShell ook netwerkadressen, bijvoorbeeld:

```text
http://192.168.1.23:8787/
```

Andere apparaten op hetzelfde wifi-netwerk kunnen dat adres openen.

## Waar worden logboeken bewaard?

Lokaal op de computer waar de server draait:

```text
data/logboeken.json
```

Online op Render:

```text
/var/data/logboeken.json
```

Maak van die map regelmatig een backup.

De server maakt bij wijzigingen ook dagbackups in:

```text
backups/
```

## Belangrijk

Zet je wachtwoord nooit in de code of in GitHub. Gebruik daarvoor Render Environment Variables.
