import {database} from './EventService';

export class RedisCacheManager {
    constructor() {
		
        //this.client = require('redis').createClient({
		//host:"142.93.216.220",
		//port:"6379",
		//no_ready_check: true,
		//auth_pass:"nodeapp123",
		//db:"3"
		//});
		 
		this.client = require('redis').createClient(6379, '142.93.216.220', {auth_pass: 'nodeapp123'});
		
		
		
		/*
		this.client.on('connect', () => {   
          console.log("connected new chec1k");
		});                               
										  
		this.client.on('error', err => {       
			console.log(err.message)
		}); 



this.client.on("message", function (channel, message) {
 console.log("Message: " + message + " on channel: " + channel + " is arrive!");
});
this.client.subscribe("notification");	
this.client.subscribe("NEW_BOOKING");
this.client.subscribe("RESERVED_BOOKING");*/
	
		
        const {promisify} = require('util');
        this.getAsync = promisify(this.client.get).bind(this.client);
        this.keysAsync = promisify(this.client.keys).bind(this.client);
        this.deleteAsync = promisify(this.client.del).bind(this.client);
    }
	

    get(key) {
        return this.getAsync(key);
    }

    set(key, value, expiry = null) {
        if (expiry) {
            this.client.set(key, value, 'EX', expiry);
        } else {
            this.client.set(key, value);
        }
    }

    async remove(booking_id) {
        this.keysAsync(`BOOKING_DISPATCH_${booking_id}_*`)
            .then((keys) => {
                if (keys instanceof Array) {
                    for (let key in keys) {
                        this.deleteAsync(keys[key]);
                    }
                }
            })
            .catch((err) => console.log(err.message));
        // get all captains from booking data and remove booking from the driverLocation
        const updates = {};

        // remove the booking from the old captains
        let data = JSON.parse(await this.getAsync(`BOOKING_DATA_${booking_id}`));
        if (data) data.captains.forEach((c) => (updates[`driverUpdateLocation/${c}/requestQueue/${booking_id}`] = null));
        await database.ref().update(updates);

        this.deleteAsync(`BOOKING_DATA_${booking_id}`);
    }


    async removeBookingQueue(booking_id) {
        this.keysAsync(`BOOKING_DISPATCH_${booking_id}_*`)
            .then((keys) => {
                if (keys instanceof Array) {
                    for (let key in keys) {
                        this.deleteAsync(keys[key]);
                    }
                }
            })
            .catch((err) => console.log(err.message));
        // get all captains from booking data and remove booking from the driverLocation
        const updates = {};

        // remove the booking from the old captains
        let data = JSON.parse(await this.getAsync(`BOOKING_DATA_${booking_id}`));
        if (data) data.captains.forEach((c) => (updates[`driverUpdateLocation/${c}/bookingQueue/${booking_id}`] = null));
        await database.ref().update(updates);

        this.deleteAsync(`BOOKING_DATA_${booking_id}`);
    }
}
