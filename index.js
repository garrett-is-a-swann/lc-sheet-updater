const puppeteer = require('puppeteer');

const config = require('config.js');

const url = 'https://classic.warcraftlogs.com/reports/' 
const report_id = process.argv.slice(2).length? process.argv[2]: undefined
if (report_id === undefined) throw 'No CLI arg given for report_id';

const readline = require('readline');
const fs = require('fs');
const {google} = require('googleapis');
const sheets = google.sheets('v4');

const TOKEN_PATH = 'token.json';

function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) {
            return getNewToken(oAuth2Client, callback);
        }
        oAuth2Client.setCredentials(JSON.parse(token));
        google.options({auth: oAuth2Client})
        if (callback) {
            callback(oAuth2Client);
        }
    });

}
    
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) {
                return console.error('Error while trying to retrieve access token', err);
            }
            oAuth2Client.setCredentials(token);

            google.options({auth: oAuth2Client})
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

function makeUri(url, path, param_list, query_sep) {
    if (query_sep == undefined) {
        query_sep = '?'
    }

    return url + path + query_sep + param_list.join('&');
}


(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    console.log(makeUri(url, report_id, ['boss=-3', 'difficulty=0'], "#"))
    await page.goto(makeUri(url, report_id, ['boss=-3', 'difficulty=0'], "#"));
    await page.waitForSelector('.composition-entry > a', {timeout: 5000});

    const players = await page.evaluate(() => {
        // dummy function for eval
        function followRawLogLinkForActor(self, what, a, b, value, d, e) {
            return value;
        }

        return Array.from(document.querySelectorAll('.composition-entry > a'))
            .map(entry => 
                entry.innerHTML
                +',' + eval('(' + entry.onclick + ')()')
                +',' + entry.className
            )
            .filter((entry, index, list) => list.indexOf(entry) === index)
            .map(entry => entry.split(','))
    })


    console.log(players)

    let physical_append = []
    let caster_append = []
    let healer_append = []

    for (let player of players) {
        const next = makeUri(url, report_id, ['boss=-3', 'difficulty=0', 'source=' + player[1]], "#");
        console.log(next)
        await page.goto(next);
        await page.waitForSelector('#summary-gear-0', {timeout: 1000});

        const gear_list = await page.evaluate((player_data) => {
            return Array.from(document.querySelectorAll('#summary-gear-0 > tbody > tr')).map(row => {
                console.log(row)
                return [
                    row.children[0].innerHTML
                    ,row.children[1].innerHTML.replace('\n', '')
                    ,('=HYPERLINK("' +  row.children[2].children[0].href + 
                        '","' + row.children[2].children[0].children[1].innerHTML + '")').replace('\n', '')
                    ,''
                    ,''
                    ,player_data[0]
                    ,player_data[2]
                ]
            });
        }, player);

        if (['Mage', 'Warlock'].includes(player[2]) || ['Googs', 'Lightwielder'].includes(player[0])) {
            caster_append = caster_append.concat(gear_list);
            continue;
        }

        if (['Warrior', 'Rogue', 'Hunter'].includes(player[2]) || ['Unburdened', 'Finarphir'].includes(player[0])) {
            physical_append = physical_append.concat(gear_list);
            continue;
        }

        if (['Priest', 'Paladin', 'Druid'].includes(player[2])) {
            healer_append = healer_append.concat(gear_list)
            continue;
        }
        break;
    }


    authorize(config.google_api, async () => {
        let res = undefined
        if (caster_append.length) {
             res = await sheets.spreadsheets.values.append({
                spreadsheetId: config.spreadsheetId,
                range: 'caster_data!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: caster_append
                }
            });
        }

        console.log(physical_append.length)
        if (physical_append.length) {
            res = await sheets.spreadsheets.values.append({
                spreadsheetId: config.spreadsheetId,
                range: 'physical_data!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: physical_append
                }
            });
        }

        if (healer_append.length) {
            res = await sheets.spreadsheets.values.append({
                spreadsheetId: config.spreadsheetId,
                range: 'healer_data!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: healer_append
                }
            });
        }

    });

    await browser.close();
})()
