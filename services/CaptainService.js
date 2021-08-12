import {RedisCacheManager} from './RedisCacheManager';
import {database, captains, newCaptainsIndex, suggestionCaptains} from './EventService';
import {DistanceService} from './DistanceService';
import axios from "axios";

export class CaptainService {
    constructor() {
        this.redisCacheClient = new RedisCacheManager();
		
        //const publisher = require('redis').createClient();
		const publisher = require('redis').createClient(6379, '142.93.216.220', {auth_pass: 'nodeapp123'});

        const {promisify} = require('util');
        this.publishAsync = promisify(publisher.publish).bind(publisher);
    }

    getNearbyCaptainsFromFirebase(lat, lng, type, distance, excluded_captains) {
        return captains.filter((cap, i) => {
            cap.index = newCaptainsIndex[i];
            // check empty object
            if (Object.keys(cap).length <= 2) {
                return false;
            }
            // check if he has something in his booking queue
            if (cap.bookingQueue && Object.keys(cap.bookingQueue).length !== 0) {
                return false;
            }
            // check if he has already got a booking
            if (cap.requestQueue && Object.keys(cap.requestQueue).length !== 0) {
                return false;
            }
            // check if active
            if (cap.status && cap.status.toLowerCase() === 'inactive') {
                return false;
            }
            // check if execluded
            /*	if (excluded_captains.find((id) => id === i)) {
                    return false;
                }*/
            // check the type array of string [TALYA]
            if (type.length === 1) {
                switch (type[0]) {
                    case 'TALYA':
                        if (cap.isOutsideDriver === true) {
                            return false;
                        }
                        break;
                    case 'OTHER': // if not outside that means it is TALYA
                        if (cap.isOutsideDriver === false) {
                            return false;
                        }
                        break;
                }
            }
            // calculate the difference in lat,lng
            const dis = DistanceService.p2Km(cap.latitude, cap.longitude, lat, lng);
            // console.log(parseFloat(dis));
            // console.log(i);
            // check if distance is in range
            if (parseFloat(dis) > parseFloat(distance)) {
                return false;
            }
            return true;
        });
    }

    async dispatch(booking_id, lat, lng, dispatch_try, excluded_captains, book, origin) {
		console.log("Munteha",dispatch_try);
        let conditions = {
            1: {
                type: ['TALYA'],
                distance: 3,
                popup_time: 20,

            },
            2: {
                type: ['OTHER'],
                distance: 3,
                popup_time: 20,

            },
            3: {
                type: ['OTHER', 'TALYA'],
                distance: 6,
                popup_time: 30
            },
        };
        console.log(booking_id, lat, lng, dispatch_try, excluded_captains, conditions[dispatch_try]);
        while (dispatch_try <= 3) {
            book["popup_time"] = conditions[dispatch_try].popup_time

            console.log(`TRY TO DISPATCH ${booking_id}, DISPATCH TRY ${dispatch_try}`);
            let nearbyCaptains = this.getNearbyCaptainsFromFirebase(
                lat,
                lng,
                conditions[dispatch_try].type,
                conditions[dispatch_try].distance,
                excluded_captains
            );

            nearbyCaptains.forEach(element => {
                let driverInfo;
                driverInfo = {
                    "driver_id": element.index,
                    "lat": element.latitude,
                    "long": element.longitude
                }

                suggestionCaptains.push(driverInfo)
            })

            nearbyCaptains = nearbyCaptains.map((value) => value.index);
            if (nearbyCaptains.length) {
                // PUBLISH SOLUTION
                console.log(
                    `PUBLISH DISPATCH SUGGESTION FOR ${booking_id}, DISPATCH TRY ${dispatch_try}, captains count ${nearbyCaptains.length}`
                );

                // set booking to the suggested drivers
                const updateRTD = {};
                console.log(suggestionCaptains)

                nearbyCaptains.forEach((c) => {
                    updateRTD[`/driverUpdateLocation/${c}/requestQueue/${booking_id}`] = book;
                });

                const suggestion = {
                    booking_id,
                    captains: nearbyCaptains,
                    origin,
                    valid_for_in_seconds: 30,
                };

                updateRTD[`/service_booking/${booking_id}`] = suggestion;
                // update firebase
                await database.ref().update(updateRTD);

                console.log('REDIS SET ', `BOOKING_DISPATCH_${booking_id}_${dispatch_try}`);
                // Todo: return to 30 sec
                this.redisCacheClient.set(`BOOKING_DISPATCH_${booking_id}_${dispatch_try}`, 'DISPATCH_TIMER', 30);
                this.redisCacheClient.set(
                    `BOOKING_DATA_${booking_id}`,
                    JSON.stringify({
                        id: booking_id,
                        lat,
                        lng,
                        excluded_captains: suggestion.captains.concat(excluded_captains),
                        book,
                        origin,
                        captains: suggestion.captains.concat(excluded_captains),
                    })
                );
                break;
            }
            dispatch_try += 1;
        }
			console.log("LOkesh", dispatch_try);
        if (dispatch_try > 3) {

            // update status to denied
            await database.ref(`booking_dev/${booking_id}`).update({status: 'denied'});
            await this.redisCacheClient.remove(booking_id);

            if (suggestionCaptains.length === 0) {
                console.log("isNoDriver")
                this.sendDeniedBook(booking_id)
            } else {
                console.log("sendUnacceptedBook")
                this.sendUnacceptedBook(booking_id)
            }
            console.log(`UNABLE TO FIND SOLUTION FOR BOOKING ${booking_id}`);
            // Need to send an api
        }
    }

    async cancelRide(bookingId, bookingStatus,cancelledby) {
        if (bookingStatus === "cancelRide") {
            // In this case we should remove bookingQueue from
            // the driver and change the status to cancelled in booking_dev.
            database
                .ref(`booking_dev/${bookingId}/status`)
                .get()
                .then((snapshot) => {

                    // remove the tied redis event
                    const updates = {};
                    const updates1 = {};
					const book={
						cancelled_by:cancelledby
					};
                    updates[`booking_dev/${bookingId}/status`] = 'cancelled';
					
                    database.ref().update(updates);
					 database
                        .ref(`booking_dev/${bookingId}`)
                        .set(book);
					
                    // Todo need to find way to remove the booking id  from the driver
                    newCaptainsIndex.forEach((c) => (updates[`driverUpdateLocation/${c}/bookingQueue/${bookingId}`] = null));

                    database.ref().update(updates);
                    //this.redisCacheClient.removeBookingQueue(bookingId);
                });

        } else {
            database
                .ref(`booking_dev/${bookingId}/status`)
                .get()
                .then((snapshot) => {
                    if (snapshot.val() !== 'accepted') {
                        // remove the tied redis event
                        const redisCacheClient = new RedisCacheManager();
                        const updates = {};

                        updates[`booking_dev/${bookingId}/status`] = 'cancelled';

                        database.ref().update(updates);
                        redisCacheClient.remove(bookingId);
                    }
                });
        }
    }

    sendDeniedBook(bookingId) {

        const data = {
            bookingId: bookingId,
            status: 'denied'
        };

        axios.post('http://68.183.94.18/admin/api/v1/admin/bookingdenied', data, {
            headers: {
                'Content-Type': 'application/json',
            }
        })
            .then((res) => {
                console.log(`Status: ${res.status}`);
                console.log('Body: ', res.data);
            }).catch((err) => {
            console.error(err);
        });
    }

    sendUnacceptedBook(bookingId) {

        const data = {
            booking_id: bookingId,
            driver_list: suggestionCaptains
        };

        axios.post('http://68.183.94.18/admin/api/v1/admin/unaccepted', data, {
            headers: {
                'Content-Type': 'application/json',
            }
        })
            .then((res) => {
                console.log(`Status: ${res.status}`);
                console.log('Body: ', res.data);
            }).catch((err) => {
            console.error(err);
        });
    }
}
