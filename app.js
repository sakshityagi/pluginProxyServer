"use strict";

//Declare a global data object for caching events
var EVENTS_DATA = {};

//Declare a global variable to save the time when events were cached last time. Refresh events after one day.
var Last_EVENT_SYNC_TIME = +new Date();

var YOUTUBE_API_KEY = "AIzaSyC5d5acYzAtC9fiDcCOvvpA-xX9dKwkmAA";


var express = require('express');
var app = express(),
  bodyParser = require('body-parser'),
  request = require('request'),
  ical2json = require("ical2json"),
  dateParser = require("./Utils"),
  async = require("async"),
  FeedParser = require('feedparser');

/* To Allow cross-domain Access-Control*/
var allowCrossDomain = function (req, res, next) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', "*");
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // intercept OPTIONS method
  if ('OPTIONS' == req.method) {
    res.send(200);
  }
  else {
    next();
  }
};

app.use(allowCrossDomain);
// Parsing json and urlencoded requests
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(bodyParser.json({type: 'application/vnd.api+json'}));

app.get('/', function (req, res) {
  res.send("Server running...");
});


/*
 *  Events Feed Backend starts here
 */

// API to validate ical url
app.post('/validate', function (req, res) {
  if (req.body.url) {
    request(req.body.url, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var data = ical2json.convert(body);
        if (data && data.VEVENT && data.VEVENT.length)
          res.send({'statusCode': 200});
        else
          res.send({'statusCode': 404});
      } else
        res.send({'statusCode': 500});
    });
  } else
    res.send({'statusCode': 404});
});


// API to fetch events from an ical url
app.post('/events', function (req, res) {
  var currentTime = +new Date();
  var limit = req.body.limit || 10;
  var offset = req.body.offset || 0;
  var isSyncThresholdCrossed = ((currentTime - Last_EVENT_SYNC_TIME) >= (1000 * 60 * 60 * 24));
  var paginatedListOfEvents = [];

  if (isSyncThresholdCrossed) {
    Last_EVENT_SYNC_TIME = currentTime;
  }

  if (req.body.url) {
    if (EVENTS_DATA[req.body.url] && !isSyncThresholdCrossed) {
      returnEventIndexFromCurrentDate(EVENTS_DATA[req.body.url], req.body.date, function (index) {
        if (index != -1) {
          paginatedListOfEvents = EVENTS_DATA[req.body.url].slice(offset + index, (offset + index + limit));
          res.send({
            'statusCode': 200,
            'events': paginatedListOfEvents,
            'totalEvents': EVENTS_DATA[req.body.url].length - index
          });
        } else {
          res.send({
            'statusCode': 404,
            'events': null,
            'totalEvents': 0
          });
        }
      });
    }
    else {
      request(req.body.url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          var data = ical2json.convert(body);
          if (data && data.VEVENT && data.VEVENT.length) {
            var mergedEvents = data.VCALENDAR[0].VEVENT.concat(data.VEVENT);
            processData(mergedEvents, function (events) {
              mergedEvents = events;
              mergedEvents = mergedEvents.sort(function (a, b) {
                return a.startDate - b.startDate;
              });
              EVENTS_DATA[req.body.url] = mergedEvents;
              returnEventIndexFromCurrentDate(mergedEvents, req.body.date, function (index) {
                if (index != -1) {
                  paginatedListOfEvents = mergedEvents.slice(offset + index, (offset + index + limit));
                  res.send({
                    'statusCode': 200,
                    'events': paginatedListOfEvents,
                    'totalEvents': mergedEvents.length - index
                  });
                } else {
                  res.send({
                    'statusCode': 404,
                    'events': null,
                    'totalEvents': 0
                  });
                }
              });
            });
          }
          else
            res.send({'statusCode': 404, 'events': null});
        } else
          res.send({'statusCode': 500, 'events': null});
      });
    }
  } else
    res.send({'statusCode': 404, 'events': null});
});


// API to fetch single event with given index from an ical url
app.post('/event', function (req, res) {
  var currentTime = +new Date();
  var index = req.body.index || 0;
  var isSyncThresholdCrossed = ((currentTime - Last_EVENT_SYNC_TIME) >= (1000 * 60 * 60 * 24));

  if (isSyncThresholdCrossed) {
    Last_EVENT_SYNC_TIME = currentTime;
  }

  if (req.body.url) {
    if (EVENTS_DATA[req.body.url] && EVENTS_DATA[req.body.url].length && !isSyncThresholdCrossed) {
      returnEventIndexFromCurrentDate(EVENTS_DATA[req.body.url], req.body.date, function (indexOfCurrentDateEvent) {
        if (index != -1) {
          var event = EVENTS_DATA[req.body.url][Number(index) + indexOfCurrentDateEvent];
          res.send({'statusCode': 200, 'event': event});
        } else {
          res.send({'statusCode': 404, 'event': null});
        }
      });
    }
    else {
      res.send({'statusCode': 500, 'event': null});
    }
  } else
    res.send({'statusCode': 404, 'event': null});
});


function processData(events, callback) {
  async.each(events, function (event, cb) {
    event = dateParser(event);
    cb();
  }, function () {
    callback(events);
  });
}

// Method to get index from which the events from current date onwards start

function returnEventIndexFromCurrentDate(events, date, callback) {
  var currentDate = date || +new Date(),
    eventIndex = -1;
  async.forEachOf(events, function (event, index, cb) {
    if (event.startDate >= currentDate) {
      eventIndex = index;
      cb("error");
    } else cb();
  }, function () {
    callback(eventIndex);
  });
}

/*
 *  Events Feed Backend ends here
 */

/**
 ***************************************************************
 ****************************************************************
 **/

/*
 *  Media Center RSS Backend starts here
 */

// API to validate rss feed url
app.post('/validatefeedurl', function (req, res) {
  var isValidFeedUrl = false;
  if (!req.body.feedUrl) {
    res.status(404).end(JSON.stringify({
      code: 'RSS_FEED_URL_NOT_FOUND',
      message: 'Error: Undefined rss feed url'
    }));
  } else {
    request(req.body.feedUrl, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        isValidFeedUrl = (body.match('<?xml') && (body.match('<rss') || body.match('<feed'))) ? true : false;
        res.status(200).send({
          data: {
            isValidFeedUrl: isValidFeedUrl
          },
          status: 200
        }).end();
      }
      else {
        console.error('Error:', error);
        res.status(200).send({
          data: {
            isValidFeedUrl: isValidFeedUrl
          },
          status: 200
        }).end();
      }
    });
  }
});

// API to parse and send xml in response
app.post('/parsefeedurl', function (req, res) {

  if (!req.body.feedUrl) {
    res.status(404).end(JSON.stringify({
      code: 'RSS_FEED_URL_NOT_FOUND',
      message: 'Error: Undefined rss feed url'
    }));
    return;
  }

  var feedReq = request(req.body.feedUrl)
    , feedparser = new FeedParser()
    , meta = null
    , items = [];

  feedReq.on('error', function (error) {
    console.error(error);
    res.status(404).end(JSON.stringify(error));
  });
  feedReq.on('response', function (res) {
    var stream = this;
    if (res.statusCode != 200) return this.emit('error', new Error('Bad status code'));
    stream.pipe(feedparser);
  });
  feedparser.on('error', function (err) {
    console.error(err);
  });
  feedparser.on('readable', function () {
    var stream = this
      , item;
    meta = stream.meta; // **NOTE** the "meta" is always available in the context of the feedparser instance
    while (item = stream.read()) {
      items.push(item);
    }
  });
  feedparser.on('end', function () {
    res.send({
      data: {
        meta: meta,
        items: items
      },
      status: 200
    }).end();
  });

});

/*
 *  Media Center RSS Backend ends here
 */


/**
 ***************************************************************
 ****************************************************************
 **/

/*
 *  Youtube Backend starts here
 */

// API to fetch a single video details for a given video id
app.post('/video', function (req, res) {
  if (req.body.id) {
    var _url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + req.body.id + '&key=' + YOUTUBE_API_KEY;
    request(_url, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        body = JSON.parse(body);
        if (body.items && body.items.length) {
          res.send({'statusCode': 200, 'video': body.items[0]});
        }
      } else
        res.send({'statusCode': 500,'video': null});
    });
  } else
    res.send({'statusCode': 404,'video': null});
});


//APi to fetch a paginated list of videos for a given playlist id
app.post('/videos', function (req, res) {
  if (req.body.playlistId) {
    var _url = "";
    if (req.body.pageToken)
      _url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=" + req.body.countLimit + "&pageToken=" + req.body.pageToken + "&playlistId=" + req.body.playlistId + "&key=" + YOUTUBE_API_KEY;
    else
      _url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=" + req.body.countLimit + "&playlistId=" + req.body.playlistId + "&key=" + YOUTUBE_API_KEY;
    request(_url, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        body = JSON.parse(body);
        if (body.items && body.items.length) {
          res.send({'statusCode': 200, 'videos': body});
        }
      } else
        res.send({'statusCode': 500,'videos': null});
    });
  } else
    res.send({'statusCode': 404,'videos': null});
});

/*
 *  Youtube Backend ends here
 */


var server = app.listen(process.env.PORT || 3020, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Server app listening at http://%s:%s', host, port);
});


module.exports = function () {
  return server;
};