import {CaptainService} from './CaptainService';
import {RedisCacheManager} from './RedisCacheManager';
import firebase from 'firebase/app';
import 'firebase/database';
import firebaseConfig from '../configs/firebaseConfig';

firebase.initializeApp(firebaseConfig);
export const database = firebase.database();
export let captains = [];
export let newCaptainsIndex = [];
const redis = require('redis');
let execludedCaptains = [];

export let suggestionCaptains = [];


export class EventService {
    constructor() {
		//console.log("servicevhhsd")
        // read the drivers
        this.readDriversData(); 
        this.redisSubscriberClient = redis.createClient(6379, '142.93.216.220', {auth_pass: 'nodeapp123'});
    }

    async startListening() {
        console.log('Listening started');
        let captainService = new CaptainService();
        this.redisSubscriberClient.on('message', function (channel, data) {
            switch (channel) {
                case 'NEW_BOOKING':
                    data = JSON.parse(data);
                    suggestionCaptains.length = 0;
                    const book = {
                        bookingId: data.bookingId,
                        device_id: data.device_id,
                        origin_address: data.origin.address
                    };
                    book.status = 'pending';
                    book.createdAt = Date.now();
                    database
                        .ref(`booking_dev/${data.bookingId}`)
                        .set(book)
                        .then((snapshot) => {
                            // start the dispatching rounds
                            captainService.dispatch(
                                data.bookingId,
                                data.origin.latitude,
                                data.origin.longitude,
                                1,
                                execludedCaptains,
                                book,
                                data.origin
                            );
                        });

                    break;
                case 'RESERVED_BOOKING':
                    data = JSON.parse(data);
                    // if booking is already accepted don't do any thing

                    //capId = 1 need to check cap_id if He/She has a bookingQueue
					
                    database
                        .ref(`booking_dev/${data.bookingId}/status`)
                        .get()
                        .then((snapshot) => {
                                let captionId = data.captain_id
                                let captionIndexValue = newCaptainsIndex.findIndex(() => captionId)
                                let bookingQueue = captains[captionIndexValue].bookingQueue
									
                                if (bookingQueue === undefined || bookingQueue===null)   {
				//console.log("RESERVED_BOOKING",captionId,captionIndexValue,bookingQueue, captains[captionIndexValue]);

                                    // remove the tied redis event
													
                                    const redisCacheClient = new RedisCacheManager();
									//console.log("RESERVED_BOOKING",redisCacheClient);
                                    const updates = {};
                                    updates[`booking_dev/${data.bookingId}/status`] = 'accepted';
                                    updates[`driverUpdateLocation/${captionId}/bookingQueue/${data.bookingId}`] = {
                                        booking_id: data.bookingId,
                                        createdAt: Date.now(),
                                        driver_id: captionId,
                                    };
                                    database.ref().update(updates);
                                    redisCacheClient.remove(data.bookingId);
                                } else {
                                    console.log("Error")
                                }
                            }
                        );

                    break;

                case 'CANCELLING_REQUEST':
                    data = JSON.parse(data)
                    console.log(data)
                    let bookingId = data.bookingId
                    let bookingStatus = data.isBooking
					let cancelled_by =data.cancelled_by
                    captainService.cancelRide(bookingId, bookingStatus,cancelled_by)
                    break;


                case 'DENY_REQUEST':
                    data = JSON.parse(data)

                    database
                        .ref(`booking_dev/${data.bookingId}/status`)
                        .get()
                        .then((snapshot) => {
                            if (snapshot.val() !== 'accepted') {
                                // remove the tied redis event
                                const redisCacheClient = new RedisCacheManager();
                                const updates = {};

                                updates[`booking_dev/${data.bookingId}/status`] = 'denied';

                                database.ref().update(updates);
                                redisCacheClient.remove(data.bookingId);
                            }
                        });
                    break;

                default:
                    console.log(channel);
            }
            console.log("Subscriber received message in channel '" + channel + "': " + data);
        });

        /*this.redisSubscriberClient.subscribe('NEW_AVAILABLE_CAPTAIN');
        this.redisSubscriberClient.subscribe('NEW_BUSY_CAPTAIN');
        this.redisSubscriberClient.subscribe('UPDATE_CAPTAIN_LOCATION');*/
        this.redisSubscriberClient.subscribe('NEW_BOOKING');
        this.redisSubscriberClient.subscribe('RESERVED_BOOKING');
        this.redisSubscriberClient.subscribe('CANCELLING_REQUEST');
        this.redisSubscriberClient.subscribe('DENY_REQUEST');

        this.redisSubscriberClient.on('pmessage', async function (channel, event_name, event_type) {
            const redisCacheClient = new RedisCacheManager();
            let captainService = new CaptainService();
            if (event_type === 'expired') {
                console.log(event_name);
                let booking_id = event_name.split(/:BOOKING_DISPATCH_/)[1].split('_')[0];
                let dispatching_try = Number.parseInt(event_name.split(/:BOOKING_DISPATCH_/)[1].split('_')[1]);
                let data = JSON.parse(await redisCacheClient.get(`BOOKING_DATA_${booking_id}`));
                // console.log(data);
                await captainService.dispatch(
                    data.id,
                    data.lat,
                    data.lng,
                    dispatching_try + 1,
                    data.excluded_captains,
                    data.book,
                    data.origin
                );
            }
        });

        this.redisSubscriberClient.psubscribe('__keyspace@*__:BOOKING_DISPATCH_*');
    }

    readDriversData() {
        database.ref('driverUpdateLocation').on('value', (snapshot) => {
            const data = snapshot.val();
            captains = Object.values(data);
            newCaptainsIndex = Object.keys(data);
        });
    }

}