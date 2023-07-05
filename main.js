const puppeteer = require('puppeteer-extra')
const pluginStealth = require('puppeteer-extra-plugin-stealth')
const { executablePath } = require('puppeteer')
puppeteer.use(pluginStealth())
const fs = require('fs')
require('dotenv').config();

//DATABASE
const mongoose = require('mongoose');
const conn = mongoose.connect(process.env.MONGODB_URL).then(
    () => {
        console.log('Mongo DB Connected');
    }
)

const rawdata = mongoose.model('rawdatas', mongoose.Schema({}, { strict: false }))
const workerque = mongoose.model('workerques', mongoose.Schema({}, { strict: false }))

// FUNCTIONS
function convertDaysAgoToDate(daysAgo) {
    if (daysAgo.endsWith('d ago')) {
        var days = parseInt(daysAgo.split('d')[0]);
        var currentDate = new Date();
        currentDate.setDate(currentDate.getDate() - days);
        return currentDate.toISOString();
    } else if (daysAgo.endsWith('h ago')) {
        var hours = parseInt(daysAgo.split('h')[0]);
        var currentDate = new Date();
        currentDate.setHours(currentDate.getHours() - hours);
        return currentDate.toISOString();
    } else if (daysAgo.endsWith('w ago')) {
        var weeks = parseInt(daysAgo.split('w')[0]);
        var currentDate = new Date();
        currentDate.setDate(currentDate.getDate() - weeks * 7);
        return currentDate.toISOString();
    } else if (daysAgo.endsWith('m ago')) {
        var minutes = parseInt(daysAgo.split('m')[0]);
        var currentDate = new Date();
        currentDate.setMinutes(currentDate.getMinutes() - minutes);
        return currentDate.toISOString();
    } else if (daysAgo.endsWith('s ago')) {
        var seconds = parseInt(daysAgo.split('s')[0]);
        var currentDate = new Date();
        currentDate.setSeconds(currentDate.getSeconds() - seconds);
        return currentDate.toISOString();
    } else {
        var currentDate = new Date();
        return currentDate.toISOString();
    }
}

function convertToDecimal(value) {
    const lastChar = value.slice(-1);
    const number = parseFloat(value.slice(0, -1));

    switch (lastChar.toUpperCase()) {
        case 'K':
            return number * 1000;
        case 'M':
            return number * 1000000;
        case 'B':
            return number * 1000000000;
        case 'T':
            return number * 1000000000000;
        default:
            return parseFloat(value);
    }
}


// MAIN FUNCTION
const main_function = async (workque) => {

    const datetime = new Date().toISOString()

    const { workque_username, workque_id } = workque

    let scraped = {
        workque_id: workque_id,
        workque_username: workque_username,
        workque_status: 0,
        data: [],
        info: []
    };

    // VALIDATE
    if (!workque_username) {
        await workerque.findByIdAndUpdate(workque_userid, {
            $set: { status: 400 },
            $push: { updated_at: { datetime: datetime, work: "Username is empty" } }
        }) // DONE
        console.log("Username Is Empty")
        return false
    }

    // Launch Chrome
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath(),
        defaultViewport: null,
        timeout: 0,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--no-sandbox', '--disable-infobars']
    })

    // Open a new page
    const page = await browser.newPage();

    // Navigate to a website
    await page.goto('https://www.tiktok.com/@' + workque_username, { timeout: 0 })

    // Set up request interception.
    await page.setRequestInterception(true);

    // Listen for the request event and intercept the requests
    page.on('request', (interceptedRequest) => {
        interceptedRequest.continue();
    });

    // Listen for the response event and store the responses
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/comment/list/') || url.includes('/user/detail/') || url.includes('/node/share/')) {
            const responseData = await response.json();
            scraped.data.push({ url, response: responseData })
        }
    })



    await page.waitForTimeout(5000)


    await page.evaluate(() => {
        window.scrollBy(0, 500);
    })

    // Wait for 10 seconds
    await page.waitForTimeout(10000)

    // VIDEO VIEWS
    const videoViewsElements = await page.$x('//strong[@data-e2e="video-views"]');
    scraped.videos_views_arr = []
    scraped.videos_views = 0
    scraped.videos_views_post_count = 0
    for (const videoViewsElement of videoViewsElements) {
        const data = await videoViewsElement.evaluate(node => node.textContent);
        scraped.videos_views += convertToDecimal(data)
        scraped.videos_views_arr.push(convertToDecimal(data))
        scraped.videos_views_post_count += 1
    }

    // Loop through videos
    let count = 0 // FOR VIDEO VIEWS
    const elements = await page.$x('//div//a//canvas')
    for (const element of elements) {

        var obj = {}

        const siblingDiv = await element.$x('./following-sibling::div[1]');
        const imgElement = await siblingDiv[0].$('img');
        const src = await page.evaluate(img => img.getAttribute('src'), imgElement);
        obj.video_thumbnail = src

        await element.click();
        await page.waitForTimeout(3000)



        // VIDEO DESCRIPTION
        var video_desc_Elements = await page.$x('//div[@data-e2e="browse-video-desc"]/span');
        for (const video_desc_Element of video_desc_Elements) {
            const text = await video_desc_Element.evaluate(node => node.textContent);
            obj.video_description = text
            break
        }

        // VIDEO DESCRIPTION HASHTAGS
        obj.hashtags = []
        var video_desc_hashtags_Elements = await page.$x('//div[@data-e2e="browse-video-desc"]//a/strong');
        for (const video_desc_hashtags_Element of video_desc_hashtags_Elements) {
            const text = await video_desc_hashtags_Element.evaluate(node => node.textContent);
            obj.hashtags.push(text)
        }

        // LIKES COUNT
        var videolikesElements = await page.$x('//strong[@data-e2e = "browse-like-count"]');
        for (const videolikesElement of videolikesElements) {
            const text = await videolikesElement.evaluate(node => node.textContent);
            obj.video_likes = convertToDecimal(text)
        }

        // COMMENTS COUNT
        var videocommentsElements = await page.$x('//strong[@data-e2e = "browse-comment-count"]');
        for (const videocommentsElement of videocommentsElements) {
            const text = await videocommentsElement.evaluate(node => node.textContent);
            obj.video_comments = convertToDecimal(text)
        }

        // VIDEO VIEWS
        obj.video_views = scraped.videos_views_arr[count]
        count++

        // SAVED COUNT
        var videosavedElements = await page.$x('//strong[@data-e2e = "undefined-count"]');
        for (const videosavedElement of videosavedElements) {
            const text = await videosavedElement.evaluate(node => node.textContent);
            obj.video_saved = convertToDecimal(text)
        }

        // VIDEO URL
        var videourlElements = await page.$x('//p[@data-e2e = "browse-video-link"]');
        for (const videourlElement of videourlElements) {
            var text = await videourlElement.evaluate(node => node.textContent);
            text = text.replace(/\?.*$/g, "")
            obj.video_url = text
            var segments = text.split('/')
            obj.video_id = segments[segments.length - 1]
        }

        // CREATED
        var dateElements = await page.$x('//span[@data-e2e="browser-nickname"]/span[2]');
        for (const dateElement of dateElements) {
            const text = await dateElement.evaluate(node => node.textContent);
            obj.created = convertDaysAgoToDate(text.trim())
            var myDate = new Date(obj.created)
            obj.timestampformat = myDate.getTime()
            break
        }

        scraped.info.push(obj)

        // LOOP through comments
        const commenters_imgElements = await page.$x('//a[contains(@data-e2e,"comment-avatar-1")]/span[contains(@class,"SpanAvatarContainer")]/img')
        let itteration = 0;
        for (const imgelement of commenters_imgElements) {
            const boundingBox = await imgelement.boundingBox();
            const x = boundingBox.x + boundingBox.width / 2;
            const y = boundingBox.y + boundingBox.height / 2;

            await page.mouse.move(x, y)
            await page.waitForTimeout(2000)

            const profileouterelements = await page.$x('//div[contains(@class,"DivProfileOuterContainer")]')
            for (const profileouterelement of profileouterelements) {
                profileouterelement.hover();
                break
            }

            await page.waitForTimeout(500);

            await page.evaluate(() => {
                window.scrollBy(0, 500);
            })

            await page.mouse.move(0, 0)
            await page.waitForTimeout(1000)
            if (itteration >= 3) { break; }
            itteration++
        }

        await page.keyboard.press('Escape')
    }



    await workerque.findByIdAndUpdate(workque_id, {
        $set: { status: 2 }, //WIP
        $push: { updated_at: { datetime: datetime, work: "Dataset Scraped" } }
    })

    scraped.updated_at = [{ datetime: datetime, work: "Scraped Data Inserted" }]

    const newrawdata = new rawdata(scraped)
    try {
        await newrawdata.save()
    } catch (error) {
        console.log(error)
    }

    console.log('Scrapping Completed!')
    browser.close()

}

// CALL MAIN
(async () => {
    const data = await workerque.find({ "type": 'tiktok', "status": 0 }).limit(1)
    if (data.length > 0) {
        var datetime = new Date()
        datetime = datetime.toISOString()
        await workerque.findByIdAndUpdate(data[0]._id, {
            $set: { status: 1 }, //WIP
            $push: { updated_at: { datetime: datetime, work: "Dataset Scrapping Started" } }
        })
        const object = { "workque_username": data[0].username, "workque_id": data[0]._id }
        main_function(object)
    }
})();




