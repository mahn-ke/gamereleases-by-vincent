import * as cheerio from 'cheerio';
import ical from 'ical-generator';
import moment from 'moment';
import { writeFileSync } from 'fs';

function parseRelativeDate(desc) {
    const now = moment();
    desc = desc.trim();
    if (/Yesterday/i.test(desc)) return now.clone().subtract(1, 'days').toDate();
    if (/Today/i.test(desc)) return now.clone().toDate();
    if (/Tomorrow/i.test(desc)) return now.clone().add(1, 'days').toDate();
    let match;
    if ((match = desc.match(/(\d+)\s+days?\s+ago/i))) return now.clone().subtract(parseInt(match[1]), 'days').toDate();
    if ((match = desc.match(/in\s+(\d+)\s+days?/i))) return now.clone().add(parseInt(match[1]), 'days').toDate();
    // fallback: try to parse as date
    const parsed = moment(desc, moment.ISO_8601, true);
    if (parsed.isValid()) return parsed.toDate();
    return null;
}

const codes = [
    'bp-Past', 'bp-SomeYearsAgo', 'bp-LastYear', 'bp-EarlierThisYear',
    'bp-Recent', 'bp-Today', 'bp-ComingSoon', 'bp-LaterThisYear',
    'bp-NextYear', 'bp-InSomeYears', 'bp-Future', 'bp-TBA'
];

async function fetchEventsForCode(code) {
    const url = `https://www.releases.com/partial/Releases.Www.PL.Calendar.Group?Code=${code}&Category=tracking&Section=Tracking&Interval=Breakpoints&Direction=Forward&GroupMode=Feed`;
    const cookie = process.env.RELEASES_COOKIE || '';
    const response = await fetch(url, {
        headers: {
            Cookie: `.AspNetCore.Cookies=${cookie}; `
        }
    });
    const data = "<html>" + await response.text() + "</html>";
    const $ = cheerio.load(data);
    const events = [];
    
    // a calendar with no mad_active means we haven't received a personalized response, likely due to an invalid cookie
    if ($(".RWP-Calendar-Group").length >= 1 && $('.mad_active').length <= 0) {
        console.error('Cookie no longer valid; please update it in the environment variable RELEASES_COOKIE');
        process.exit(1);
    }

    $('.RWP-Calendar-Group-List > div').each((_, el) => {
        const dateDesc = $(el).find('.RWPCC-CalendarItems-DateDescControl').text();
        const date = parseRelativeDate(dateDesc);
        if (!date) return;
        const name = $(el).find('.RWPCC-CalendarItems-CardControl-Name').text().trim();
        const types = $(el).find('.RWPCC-CalendarItems-TypeAndVersionsControl').text().trim();
        events.push({
            summary: `${name} (${types})`,
            date: moment(date).format('YYYY-MM-DD')
        });
    });
    console.log({code, events: events.flat().map(e => `${e.summary}: ${e.date}`).filter(a => !!a)});
    return events;
}

const refreshCalendar = async () => {
    const cal = ical({ name: 'Releases.com Calendar' });
    for (const code of codes) {
        const events = await fetchEventsForCode(code);
        for (const event of events) {
            cal.createEvent({
                start: event.date,
                allDay: true,
                summary: event.summary
            });
        }
    }
    const icsString = cal.toString();
    writeFileSync('releases.ics', icsString);
    console.log('iCal file generated: releases.ics');
};

refreshCalendar().catch(console.error);