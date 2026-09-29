"use strict";

const { WinccoaManager } = require("winccoa-manager");
const mqtt = require("mqtt");
const fs = require("fs");

const winccoa = new WinccoaManager();
/*
// MQTT Broker Info
const mqttServerURL = "mqtt:proveit.virtualfactory.online:1883";
const mqttUsername = "siemens";
const mqttPassword = "vendor0199";
const mqttTopic = "Enterprise/Dallas/Press/Press 103/#";
*/
// Customizable update interval in milliseconds
const updateIntervalMs = 2000;

// Runtime state
let mqttConnectionName;
let currentMqttClient = null;
let updateTimer = null;
const topics = new Set();
const topicTree = {};
let bTrigger = false;

// ------------------------- Utility Functions ----------------------------

//this dpSet is used just as a watchdog to monitor the status of the NodeJs Manager.
winccoa.dpSetTimed(
  new Date(),
  "MqttBrokerInformation.MqttBrokerConnStatus:_lock._corr._locked",
  true
);

// function to determine the data type of each topic
function determineDataType(value) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      const lv = parsed.toLowerCase();
      if (lv === "true" || lv === "false") return "boolean";
    }
    if (Array.isArray(parsed)) return "Array";
    if (typeof parsed === "object" && parsed !== null) return "string";
    return typeof parsed;
  } catch {
    const lv = value.toString().toLowerCase();
    if (lv === "true" || lv === "false") return "boolean";
    return "string";
  }
}

function saveTopicToFile(topic, dataType, filepath) {
  const entry = `${topic}\t${dataType}\n`;
  fs.appendFile(filepath, entry, (err) => {
    if (err) console.error("Error writing to topic file:", err);
  });
}

function addToTopicTree(topic, dataType) {
  const levels = topic.split("/");
  let current = topicTree;

  levels.forEach((level, i) => {
    if (!current[level]) current[level] = {};
    if (i === levels.length - 1) {
      current[level] = { type: dataType };
    }
    current = current[level];
  });
}

function updateDiscoveredTopicsDP() {
  const json = JSON.stringify(topicTree, null, 2);
  winccoa.dpSetTimed(
    new Date(),
    "MqttBrokerInformation.DiscoveredTopics",
    json
  );
  //console.log("📤 Topic tree pushed to 'DiscoveredTopics'");
}

function resetTopicData(topicFilePath) {
  topics.clear();
  for (const key in topicTree) delete topicTree[key];

  try {
    if (fs.existsSync(topicFilePath)) fs.unlinkSync(topicFilePath);
  } catch (err) {
    console.error("Error deleting topic file:", err);
  }

  fs.writeFileSync(topicFilePath, "", "utf8");
  /*
  winccoa.dpSetTimed(
    new Date(),
    "MqttBrokerInformation.DiscoveredTopics",
    "{}"
  );*/
}

async function connectToBroker(topicsFile, Conntrigger) {
  // Disconnect any existing client before making a new one
  if (currentMqttClient) {
    console.log("🔁 Reconnecting: Disconnecting previous client...");
    currentMqttClient.end(true);
    currentMqttClient = null;
  }

  // ✅ Second: Exit early if Conntrigger is false
  if (!Conntrigger) {
    console.log(
      "⚠️ Connection trigger is false. MQTT connection will not be established."
    );
    return; // 🔁 Prevent any connection logic below from running
  }

  let mqttAdressFromWinCCOA;
  let mqttServerURL;
  let mqttUsername;
  let mqttPassword;
  let mqttTopic;

  // get the WinCC OA MQTT client connection name to create the specific Discovered topics file...
  mqttConnectionName = await winccoa.dpGet(
    "MqttBrokerInformation.MqttBrokerConnName"
  );

  // Make sure to await the dpGet calls
  mqttPassword = await winccoa.dpGet(
    "MqttBrokerInformation.MqttBrokerConnPassword"
  );

  mqttTopic = await winccoa.dpGet("MqttBrokerInformation.MqttBrokerSubTopic");

  let isDpExists = false;

  isDpExists = winccoa.dpExists(`_${mqttConnectionName}.Config.Address`);
  if (isDpExists) {
    mqttAdressFromWinCCOA = await winccoa.dpGet(
      `_${mqttConnectionName}.Config.Address`
    );

    // Parse it into a JavaScript object
    const obj = JSON.parse(mqttAdressFromWinCCOA);

    //get the username and the URL of the broker connection
    mqttUsername = obj.Username;
    mqttServerURL = obj.ConnectionString;
  }

  const client = mqtt.connect("mqtt:" + mqttServerURL, {
    username: mqttUsername,
    password: mqttPassword,
    reconnectPeriod: 0, // disable auto-reconnect for clarity
  });

  currentMqttClient = client;

  client.on("connect", () => {
    console.log("✅ Connected to MQTT broker:", mqttServerURL);

    // Set the MqttBrokerConnection datapoint to true
    if (isDpExists) {
      winccoa.dpSet("MqttBrokerInformation.MqttBrokerConnStatus", true);
    }

    client.subscribe(mqttTopic, (err) => {
      if (err) console.error("❌ Subscription error:", err);
      else console.log("📡 Subscribed to topic:", mqttTopic);
    });

    // Start interval-based topic tree update
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(updateDiscoveredTopicsDP, updateIntervalMs);
  });

  client.on("error", (err) => {
    console.error(
      `❌ MQTT Error: Could not connect to broker ${mqttServerURL}`
    );
    console.error("🔍 Error Details:", err.message);

    // Set the MqttBrokerConnection datapoint to false
    if (isDpExists) {
      winccoa.dpSet("MqttBrokerInformation.MqttBrokerConnStatus", false);
    }
  });

  client.on("close", () => {
    console.log("🔌 MQTT connection closed");

    // Optional: clear update timer when connection closes
    if (updateTimer) clearInterval(updateTimer);
  });

  client.on("message", (topic, message) => {
    if (!topics.has(topic)) {
      topics.add(topic);
      //console.log(`🆕 New topic discovered: ${topic}`);

      const dataType = determineDataType(message);
      saveTopicToFile(topic, dataType, topicsFile);
      addToTopicTree(topic, dataType);
    }
  });
}

// ------------------------ Main Entry Point ------------------------
async function main() {
  const paths = winccoa.getPaths();
  const topicFilePath = `${paths[0]}/source/discovered_topics.txt`;

  const callback = (dpe, value) => {
    // Reset topic data before handling the connection
    resetTopicData(topicFilePath);

    // Ensure we're extracting the correct value, even if it's an array
    let rawValue = value;
    if (Array.isArray(value)) {
      rawValue = value[0]; // Extract the first value from the array
    }

    // Unwrap value if it is an object with a "value" property
    rawValue =
      typeof rawValue === "object" && rawValue !== null && "value" in rawValue
        ? rawValue.value
        : rawValue;

    // Determine if the value is "true" (in various formats)
    const isTrue =
      rawValue === true ||
      rawValue === "true" ||
      rawValue === 1 ||
      (typeof rawValue === "string" && rawValue.toLowerCase() === "true");
    if (isTrue) {
      console.log(`🎯 Connection trigger is TRUE — connecting...`);
      connectToBroker(topicFilePath, true);

      // Push connection status to WinCCOA
      winccoa.dpSet("MqttBrokerInformation.MqttBrokerConnStatus", true);
    } else {
      console.log(`❌ Connection trigger is FALSE — disconnecting...`);
      connectToBroker(topicFilePath, false);

      // Push connection status to WinCCOA
      winccoa.dpSet("MqttBrokerInformation.MqttBrokerConnStatus", false);
    }
  };

  // Listen to future changes in MqttClientConnTrigger
  const dpeNames = ["MqttBrokerInformation.MqttClientConnTrigger"];
  const connectionId = winccoa.dpConnect(callback, dpeNames, true);
  console.log(
    `🔄 Listening to datapoint changes, connection ID: ${connectionId}`
  );

  // ✅ Check the initial state of MqttClientConnTrigger
  const initialValue = await winccoa.dpGet(
    "MqttBrokerInformation.MqttClientConnTrigger"
  );

  // Call callback with the initial value to handle the startup state
  callback("MqttBrokerInformation.MqttClientConnTrigger", initialValue);
}
// ------------------------ Start Program ------------------------

main().catch(console.error);
