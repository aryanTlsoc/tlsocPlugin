# tlsoc_plugin

A Kibana plugin 

---

## Development

See the [kibana contributing guide](https://github.com/elastic/kibana/blob/main/CONTRIBUTING.md) for instructions setting up your development environment.

```
cd plugins
git clone https://github.com/your-org/tlsoc-plugin.git tlsoc_plugin
cd ..
```


```
# Run bootstrap again to link the new plugin's dependencies
yarn kbn bootstrap
```

From terminal1, run UI Optimizer

```
cd plugins/tlsoc_plugin
yarn plugin-helpers dev --watch
```

From terminal 2, run the server - 

```
export NODE_OPTIONS="--max-old-space-size=8192" 
```
once only

```
yarn start --dev --no-cache --plugin-path="plugins/nameOfplugin"--elasticsearch.hosts=https://10.130.171.246:9200 --elasticsearch.username=name --elasticsearch.password=pass --elasticsearch.ssl.verificationMode=none --xpack.encryptedSavedObjects.encryptionKey=key
```


## Scripts

<dl>
  <dt><code>yarn kbn bootstrap</code></dt>
  <dd>Execute this to install node_modules and setup the dependencies in your plugin and in Kibana</dd>

  <dt><code>yarn plugin-helpers build</code></dt>
  <dd>Execute this to create a distributable version of this plugin that can be installed in Kibana</dd>

  <dt><code>yarn plugin-helpers dev --watch</code></dt>
    <dd>Execute this to build your plugin ui browser side so Kibana could pick up when started in development</dd>
</dl>
