const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const config = require('../config');

class InfluxWriter {
    constructor() {
        this.client = new InfluxDB({
            url: config.influx.url,
            token: config.influx.token
        });

        this.writeApi = this.client.getWriteApi(config.influx.org, config.influx.bucket, 'ns');
    }

    writePoint(point) {
        this.writeApi.writePoint(point);
    }

    writePoints(points) {
        this.writeApi.writePoints(points);
    }

    async flush() {
        try {
            await this.writeApi.flush();
        } catch (e) {
            console.error('[InfluxWriter] Write failed:', e);
        }
    }

    async close() {
        await this.writeApi.close();
    }
}

module.exports = new InfluxWriter();
