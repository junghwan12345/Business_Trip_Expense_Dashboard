package com.parkingfloor.app

import com.parkingfloor.app.data.ParkingDecider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ParkingDeciderTest {

    private val plateau = 12_000L

    @Test fun btDisconnectParksImmediately() {
        assertTrue(
            ParkingDecider.shouldPark(
                elapsedMs = 1_000, maxRiseHpa = 0.0f,
                btDisconnected = true, pressureStableForMs = 0, plateauMs = plateau,
                plateauAllowed = false
            )
        )
    }

    @Test fun plateauDoesNotParkWithoutBluetooth() {
        assertFalse(
            ParkingDecider.shouldPark(
                elapsedMs = 30_000, maxRiseHpa = 0.8f,
                btDisconnected = false, pressureStableForMs = 60_000, plateauMs = plateau,
                plateauAllowed = true
            )
        )
    }

    @Test fun pressureDescentDoesNotParkByItself() {
        assertFalse(
            ParkingDecider.shouldPark(
                elapsedMs = 30_000, maxRiseHpa = 0.8f,
                btDisconnected = false, pressureStableForMs = 0, plateauMs = plateau,
                plateauAllowed = false
            )
        )
    }

    @Test fun descendedThreshold() {
        assertFalse(ParkingDecider.descended(0.19f))
        assertTrue(ParkingDecider.descended(0.25f))
    }
}
