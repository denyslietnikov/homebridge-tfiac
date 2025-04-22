# Homebridge Tfiac  
Homebridge Tfiac is a Homebridge plugin that enables you to control air conditioners using the TFIAC protocol – the same protocol used by the popular iOS application [CloudAircon](https://apps.apple.com/app/cloudaircon) for both local network and cloud-based control. CloudAircon supports a wide range of models—reportedly over 15 different air conditioner models from leading manufacturers—and appears to be implemented on modules that utilize BroadLink chipsets. By reverse-engineering this protocol, Homebridge Tfiac brings full HomeKit integration to your air conditioners, allowing you to manage power, temperature, operating mode, fan speed, and swing settings seamlessly through Siri, Home apps, or automations.  

## Features  
* Power Control: Turn your AC unit on or off.  
* Temperature Setting: Adjust the target temperature.  
* Mode Selection: Switch between cooling, heating, or auto modes.  
* Fan Speed: Set the fan speed (Low, Medium, High, or Auto).  
* Swing Control: Control the horizontal/vertical swing settings.  
* Real-Time Status Updates: Polling mechanism to update the current state of your AC.  
* Dynamic Platform: Easily manage multiple AC units from a single configuration.  

## Requirements
* Node.js: v16 or later.  
* Homebridge: v1.8.0 or later (v2.0.0-beta.0 supported).  
* Air Conditioners: Devices that support the TFIAC protocol via UDP.  

## Installation  
* Install Homebridge if you haven’t already. Follow the [Homebridge Installation Guide](https://homebridge.io).  
* Install Homebridge Tfiac as a global npm package or via Homebridge Config UI X:  

```
npm install -g homebridge-tfiac
```
Or add it as a custom repository in Homebridge Config UI X.  

## Configuration  
The plugin is registered as a dynamic platform. Add a new platform entry in your Homebridge config.json similar to the example below:  

```
{
  "platforms": [
    {
      "platform": "TfiacPlatform",
      "name": "TfiacPlatform",
      "devices": [
        {
          "name": "Living Room AC",
          "ip": "192.168.1.100",
          "updateInterval": 30,
          "enableSleep": true,
          "enableDisplay": true,
          "enableDry": true,
          "enableFanOnly": true,
          "enableStandaloneFan": true,
          "enableHorizontalSwing": true,
          "enableTurbo": true,
          "enableEco": true,
          "enableBeep": true,
          "enableFanSpeed": true
        },
        {
          "name": "Bedroom AC",
          "ip": "192.168.1.101",
          "updateInterval": 60,
          "enableSleep": false,
          "enableDisplay": false
        }
      ]
    }
  ]
}
```

## Config Schema  
If you are using Homebridge Config UI X, the plugin provides a JSON schema (config.schema.json) that allows you to edit the configuration via the UI.  Ensure that the pluginAlias in the schema is set to "TfiacPlatform" and the pluginType is "platform".  

## Advanced Configuration Options

You can fine-tune which features are available for each device by adding the following boolean flags to each device entry:

- `enableSleep`: Show Sleep Mode switch (default: true)
- `enableDisplay`: Show Display switch (default: true)
- `enableDry`: Show Dry Mode switch (default: true)
- `enableFanOnly`: Show Fan Only Mode switch (default: true)
- `enableStandaloneFan`: Show Standalone Fan accessory (default: true)
- `enableHorizontalSwing`: Show Horizontal Swing switch (default: true)
- `enableTurbo`: Show Turbo Mode switch (default: true)
- `enableEco`: Show Eco Mode switch (default: true)
- `enableBeep`: Show Beep switch (default: true)
- `enableFanSpeed`: Show Fan Speed control (default: true)

If any of these are set to `false`, the corresponding accessory or switch will not be created for that device.

See the Configuration example above for a complete JSON snippet including flags.

#### Device Discovery
If you do not specify device addresses (the `devices` array) in your configuration, the plugin will automatically attempt to discover compatible air conditioners on your local network and use default settings for them. Manual control of this behavior is not required.

## Usage  
After configuring, restart Homebridge. The plugin will:  
* Create accessories for each configured AC unit.  
* Poll each device at the specified interval to update its status.  
* Allow you to control power, temperature, mode, fan speed, and swing through HomeKit-enabled apps.  

You can control your ACs using Siri, HomeKit apps, or through automations set up in Homebridge Config UI X.