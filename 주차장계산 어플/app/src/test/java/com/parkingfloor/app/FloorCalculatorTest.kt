package com.parkingfloor.app

import com.parkingfloor.app.data.FloorCalculator
import org.junit.Assert.assertEquals
import org.junit.Test

class FloorCalculatorTest {

    @Test fun samePressureIsGroundFloor() {
        assertEquals(0, FloorCalculator.floorIndex(1000f, 1000f, 0.3f))
    }

    @Test fun risePoint3IsB1() {
        assertEquals(1, FloorCalculator.floorIndex(1000f, 1000.3f, 0.3f))
    }

    @Test fun rise1Point2IsB4() {
        assertEquals(4, FloorCalculator.floorIndex(1000f, 1001.2f, 0.3f))
    }

    @Test fun clampsToB5() {
        assertEquals(5, FloorCalculator.floorIndex(1000f, 1005f, 0.3f))
    }

    @Test fun clampsToGroundWhenLower() {
        assertEquals(0, FloorCalculator.floorIndex(1000f, 999f, 0.3f))
    }
}
