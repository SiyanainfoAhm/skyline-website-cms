import unittest

from app.extractors import check_digit, extract, parse_td3_mrz


class ExtractorTests(unittest.TestCase):
    def test_icao_check_digit(self):
        self.assertEqual(check_digit("L898902C3"), 6)

    def test_td3_passport_uses_checksum_validated_values(self):
        result = parse_td3_mrz("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10")
        values = {field.key: field.value for field in result.fields}
        self.assertEqual(values["passport_number"], "L898902C3")
        self.assertEqual(values["dob"], "1974-08-12")
        self.assertEqual(values["passport_expiry"], "2012-04-15")

    def test_html_like_text_is_not_treated_as_academic_data(self):
        result = extract("<html>maintenance</html>", "academic")
        self.assertEqual(result.fields, [])

    def test_visa_never_claims_government_verification(self):
        result = extract("Visa Subclass: 500\nVisa Grant Number: EGO123", "visa")
        self.assertEqual({field.key for field in result.fields}, {"visa_subclass", "visa_grant_number"})

    def test_original_script_address_is_preserved(self):
        result = extract("Address: 서울특별시 중구 세종대로 110", "international_address")
        values = {field.key: field.value for field in result.fields}
        self.assertEqual(values["ov_address_original"], "서울특별시 중구 세종대로 110")
