import re
from datetime import date
from typing import List, Optional

from sqlalchemy.orm import Session

from models import BarcodeBatchRule, ParseLog, Reagent
from schemas import BarcodeParseResult, CandidateInfo


class BarcodeParser:
    def __init__(self, db: Session):
        self.db = db

    def parse(self, barcode: str) -> BarcodeParseResult:
        """
        Parse barcode and return match result.
        Match priority: exact > prefix.
        """
        product_code = self._extract_product_code(barcode)
        production_date = self._extract_production_date(barcode)
        expiry_date = self._extract_expiry_date(barcode)

        exact_match = self._try_exact_match(barcode)
        if exact_match:
            self._log_parse(barcode, "exact", exact_match.id)
            return self._build_result(
                barcode=barcode,
                match_type="exact",
                reagent=exact_match,
                confidence="high",
                structured_fields={
                    "product_code": product_code,
                    "production_date": production_date,
                    "expiry_date": expiry_date,
                    "batch_no": self._extract_batch_no_for_reagent(
                        barcode,
                        exact_match,
                        product_code,
                    ),
                },
            )

        prefix_matches = self._try_prefix_match(barcode)
        if prefix_matches:
            if len(prefix_matches) == 1:
                self._log_parse(barcode, "prefix", prefix_matches[0].id)
                return self._build_result(
                    barcode=barcode,
                    match_type="prefix",
                    reagent=prefix_matches[0],
                    confidence="medium",
                    structured_fields={
                        "product_code": product_code,
                        "production_date": production_date,
                        "expiry_date": expiry_date,
                        "batch_no": self._extract_batch_no_for_reagent(
                            barcode,
                            prefix_matches[0],
                            product_code,
                        ),
                    },
                )

            self._log_parse(barcode, "prefix", None)
            candidates = [self._build_candidate(reagent) for reagent in prefix_matches[:5]]
            generic_batch_no = self._extract_batch_no(barcode)
            learned_batch_no, generic_rule = self._extract_batch_no_from_instrument_rules(barcode)
            product_family_instrument = self._infer_instrument_from_product_family(product_code)
            inferred_instrument = (
                product_family_instrument
                or (
                    generic_rule.instrument
                    if generic_rule and generic_rule.instrument
                    else None
                )
            )
            inferred_work_group = inferred_instrument.work_group if inferred_instrument else None
            return BarcodeParseResult(
                raw_barcode=barcode,
                match_type="prefix",
                reagent_id=None,
                reagent_name=None,
                instrument_id=inferred_instrument.id if inferred_instrument else None,
                instrument_name=inferred_instrument.name if inferred_instrument else None,
                work_group_id=inferred_work_group.id if inferred_work_group else None,
                work_group_name=inferred_work_group.name if inferred_work_group else None,
                extracted_product_code=product_code,
                extracted_production_date=production_date,
                extracted_batch_no=generic_batch_no or learned_batch_no,
                extracted_expiry_date=expiry_date,
                package_to_min_qty=1,
                confidence="medium",
                candidates=candidates,
            )

        self._log_parse(barcode, "none", None)
        generic_batch_no = self._extract_batch_no(barcode)
        learned_batch_no, generic_rule = self._extract_batch_no_from_instrument_rules(barcode)
        product_family_instrument = self._infer_instrument_from_product_family(product_code)
        generic_instrument = (
            product_family_instrument
            or (generic_rule.instrument if generic_rule else None)
        )
        generic_work_group = generic_instrument.work_group if generic_instrument else None
        return BarcodeParseResult(
            raw_barcode=barcode,
            match_type="none",
            reagent_id=None,
            reagent_name=None,
            instrument_id=generic_instrument.id if generic_instrument else None,
            instrument_name=generic_instrument.name if generic_instrument else None,
            work_group_id=generic_work_group.id if generic_work_group else None,
            work_group_name=generic_work_group.name if generic_work_group else None,
            extracted_product_code=product_code,
            extracted_production_date=production_date,
            extracted_batch_no=generic_batch_no or learned_batch_no,
            extracted_expiry_date=expiry_date,
            package_unit=None,
            min_unit=None,
            package_to_min_qty=1,
            confidence="low",
            candidates=[],
        )

    def learn_batch_rule(
        self,
        barcode: str,
        reagent: Reagent,
        confirmed_batch_no: str,
        parsed_batch_no: str | None = None,
    ) -> bool:
        cleaned_barcode = self._normalize_rule_value(barcode)
        cleaned_batch = self._normalize_rule_value(confirmed_batch_no)
        cleaned_parsed = self._normalize_rule_value(parsed_batch_no)

        if not cleaned_barcode or not cleaned_batch or not reagent.instrument_id:
            return False

        if cleaned_parsed and cleaned_parsed == cleaned_batch:
            return False

        product_code = self._extract_product_code(cleaned_barcode)
        anchor, offset = self._infer_batch_position(cleaned_barcode, cleaned_batch)
        if offset is None:
            return False

        self._upsert_batch_rule(
            instrument_id=reagent.instrument_id,
            reagent_id=reagent.id,
            product_code=product_code,
            batch_anchor=anchor,
            batch_offset=offset,
            batch_length=len(cleaned_batch),
            raw_barcode_sample=cleaned_barcode,
            learned_batch_no=cleaned_batch,
        )

        if anchor == "10" and offset == 0:
            self._upsert_batch_rule(
                instrument_id=reagent.instrument_id,
                reagent_id=None,
                product_code=None,
                batch_anchor=anchor,
                batch_offset=offset,
                batch_length=len(cleaned_batch),
                raw_barcode_sample=cleaned_barcode,
                learned_batch_no=cleaned_batch,
            )

        return True

    def _build_candidate(self, reagent: Reagent) -> CandidateInfo:
        instrument = reagent.instrument
        work_group = instrument.work_group if instrument else None
        return CandidateInfo(
            id=reagent.id,
            name=reagent.name,
            instrument_id=instrument.id if instrument else None,
            instrument_name=instrument.name if instrument else None,
            work_group_id=work_group.id if work_group else None,
            work_group_name=work_group.name if work_group else None,
            package_unit=reagent.package_unit,
            min_unit=reagent.unit,
            package_to_min_qty=reagent.package_to_min_qty or 1,
        )

    def _build_result(
        self,
        barcode: str,
        match_type: str,
        reagent: Reagent,
        confidence: str,
        structured_fields: dict,
    ) -> BarcodeParseResult:
        instrument = reagent.instrument
        work_group = instrument.work_group if instrument else None
        return BarcodeParseResult(
            raw_barcode=barcode,
            match_type=match_type,
            reagent_id=reagent.id,
            reagent_name=reagent.name,
            instrument_id=instrument.id if instrument else None,
            instrument_name=instrument.name if instrument else None,
            work_group_id=work_group.id if work_group else None,
            work_group_name=work_group.name if work_group else None,
            extracted_product_code=structured_fields["product_code"],
            extracted_production_date=structured_fields["production_date"],
            extracted_batch_no=structured_fields["batch_no"],
            extracted_expiry_date=structured_fields["expiry_date"],
            package_unit=reagent.package_unit,
            min_unit=reagent.unit,
            package_to_min_qty=reagent.package_to_min_qty or 1,
            confidence=confidence,
            candidates=[],
        )

    def _extract_product_code(self, barcode: str) -> Optional[str]:
        gs1_match = re.search(r"01(\d{14})", barcode)
        if gs1_match:
            return gs1_match.group(1)

        fallback_match = re.search(r"\d{10,18}", barcode)
        if fallback_match:
            return fallback_match.group(0)

        return None

    def _extract_production_date(self, barcode: str) -> Optional[date]:
        product_code = self._extract_product_code(barcode)
        if product_code:
            product_prefix = f"01{product_code}"
            product_index = barcode.find(product_prefix)
            if product_index >= 0:
                ai_start = product_index + len(product_prefix)
                if barcode[ai_start:ai_start + 2] == "11":
                    parsed_date = self._parse_ai_date(barcode[ai_start + 2:ai_start + 8])
                    if parsed_date:
                        return parsed_date

        for ai_match in re.finditer(r"(?=11(\d{6}))", barcode):
            parsed_date = self._parse_ai_date(ai_match.group(1))
            if parsed_date:
                return parsed_date

        heuristic_match = re.search(r"21\d(\d{6})17", barcode)
        if heuristic_match:
            return self._parse_ai_date(heuristic_match.group(1))

        return None

    def _try_exact_match(self, barcode: str) -> Optional[Reagent]:
        return self.db.query(Reagent).filter(
            Reagent.match_mode == "exact",
            Reagent.match_pattern == barcode,
        ).first()

    def _try_prefix_match(self, barcode: str) -> List[Reagent]:
        all_prefix_reagents = (
            self.db.query(Reagent)
            .filter(Reagent.match_mode == "prefix")
            .order_by(Reagent.created_at.asc())
            .all()
        )
        return [reagent for reagent in all_prefix_reagents if barcode.startswith(reagent.match_pattern)]

    def _extract_batch_no_for_reagent(
        self,
        barcode: str,
        reagent: Reagent,
        product_code: str | None,
    ) -> Optional[str]:
        learned_batch = self._extract_batch_no_from_rule(barcode, reagent, product_code)
        if learned_batch:
            return learned_batch
        generic_batch = self._extract_batch_no(barcode)
        if generic_batch:
            return generic_batch
        instrument_batch, _ = self._extract_batch_no_from_instrument_rules(
            barcode,
            instrument_id=reagent.instrument_id,
        )
        if instrument_batch:
            return instrument_batch
        return None

    def _extract_batch_no_from_rule(
        self,
        barcode: str,
        reagent: Reagent,
        product_code: str | None,
    ) -> Optional[str]:
        query = self.db.query(BarcodeBatchRule).filter(
            BarcodeBatchRule.instrument_id == reagent.instrument_id,
            BarcodeBatchRule.is_active.is_(True),
        )

        if product_code:
            product_rule = (
                query.filter(BarcodeBatchRule.product_code == product_code)
                .order_by(BarcodeBatchRule.created_at.desc())
                .first()
            )
            extracted = self._apply_batch_rule(barcode, product_rule)
            if extracted:
                return extracted

        reagent_rule = (
            query.filter(
                BarcodeBatchRule.reagent_id == reagent.id,
                BarcodeBatchRule.product_code.is_(None),
            )
            .order_by(BarcodeBatchRule.created_at.desc())
            .first()
        )
        extracted = self._apply_batch_rule(barcode, reagent_rule)
        if extracted:
            return extracted

        generic_rule = (
            query.filter(
                BarcodeBatchRule.reagent_id.is_(None),
                BarcodeBatchRule.product_code.is_(None),
            )
            .order_by(BarcodeBatchRule.created_at.desc())
            .first()
        )
        return self._apply_batch_rule(barcode, generic_rule)

    def _extract_batch_no_from_instrument_rules(
        self,
        barcode: str,
        instrument_id: int | None = None,
    ) -> tuple[Optional[str], BarcodeBatchRule | None]:
        current_product_code = self._extract_product_code(barcode)
        query = self.db.query(BarcodeBatchRule).filter(
            BarcodeBatchRule.is_active.is_(True),
        )
        if instrument_id is not None:
            query = query.filter(BarcodeBatchRule.instrument_id == instrument_id)

        active_rules = query.order_by(BarcodeBatchRule.created_at.desc()).all()

        if not active_rules:
            return None, None

        instrument_matches: dict[int, dict[str, BarcodeBatchRule]] = {}
        for rule in active_rules:
            if rule.product_code and rule.product_code != current_product_code:
                continue
            extracted = self._apply_batch_rule(barcode, rule)
            if not extracted:
                continue
            instrument_bucket = instrument_matches.setdefault(rule.instrument_id, {})
            if extracted not in instrument_bucket:
                instrument_bucket[extracted] = rule

        resolved_matches: list[tuple[str, BarcodeBatchRule]] = []
        for matches in instrument_matches.values():
            if len(matches) == 1:
                batch_no = next(iter(matches))
                resolved_matches.append((batch_no, matches[batch_no]))

        if len(resolved_matches) != 1:
            return None, None

        return resolved_matches[0]

    def _apply_batch_rule(
        self,
        barcode: str,
        rule: BarcodeBatchRule | None,
    ) -> Optional[str]:
        if not rule or rule.batch_length <= 0:
            return None

        if rule.batch_anchor:
            starts = []
            for anchor_index in self._find_anchor_indices(barcode, rule.batch_anchor):
                start = anchor_index + len(rule.batch_anchor) + rule.batch_offset
                if start < 0:
                    continue
                end = start + rule.batch_length
                if end > len(barcode):
                    continue
                starts.append(start)

            if not starts:
                return None

            follow_token = self._derive_rule_follow_token(rule)
            sample_rank = self._derive_rule_anchor_rank(rule)

            ranked_candidates = []
            if sample_rank is not None and sample_rank < len(starts):
                ranked_candidates.append(starts[sample_rank])

            for start in starts:
                if start not in ranked_candidates:
                    ranked_candidates.append(start)

            for start in ranked_candidates:
                end = start + rule.batch_length
                if follow_token and barcode[end:end + len(follow_token)] != follow_token:
                    continue
                extracted = barcode[start:end].strip()
                if extracted:
                    return extracted
            return None
        else:
            start = rule.batch_offset

        if start is None or start < 0:
            return None

        end = start + rule.batch_length
        if end > len(barcode):
            return None

        extracted = barcode[start:end].strip()
        return extracted or None

    def _extract_batch_no(self, barcode: str) -> Optional[str]:
        ai_sequence_match = re.search(r"11\d{6}17\d{6}10(.+)", barcode)
        if ai_sequence_match:
            lot = ai_sequence_match.group(1).strip()
            if lot:
                normalized_lot = self._extract_structured_lot(lot)
                return normalized_lot or lot

        expiry_matches = list(re.finditer(r"17\d{6}", barcode))
        for expiry_match in reversed(expiry_matches):
            lot_anchor = barcode.find("10", expiry_match.end())
            if lot_anchor < 0:
                continue
            lot = barcode[lot_anchor + 2 :].strip()
            if lot:
                normalized_lot = self._extract_structured_lot(lot)
                return normalized_lot or lot

        lot_anchor = barcode.rfind("10")
        if lot_anchor >= 0:
            lot = barcode[lot_anchor + 2 :].strip()
            if lot:
                normalized_lot = self._extract_structured_lot(lot)
                return normalized_lot or lot

        patterns = [
            r"[A-Z]{2,}\d{4,}",
            r"\d{6,}[A-Z]{0,2}",
        ]

        for pattern in patterns:
            match = re.search(pattern, barcode)
            if match:
                return match.group(0)

        return None

    def _extract_structured_lot(self, lot: str) -> Optional[str]:
        normalized_lot = self._normalize_rule_value(lot)
        x8_match = re.match(r"^(\d{9})2401302\d{5}M$", normalized_lot)
        if x8_match:
            return x8_match.group(1)
        return None

    def _infer_instrument_from_product_family(self, product_code: str | None):
        current_product = self._normalize_product_family_code(product_code)
        if not current_product:
            return None

        scores: dict[int, dict[str, object]] = {}
        reagents = (
            self.db.query(Reagent)
            .filter(Reagent.instrument_id.isnot(None))
            .all()
        )
        for reagent in reagents:
            if not reagent.instrument:
                continue
            for known_product in self._known_product_family_codes(reagent):
                common_length = self._common_prefix_length(current_product, known_product)
                if common_length < 10:
                    continue
                score = scores.setdefault(
                    reagent.instrument_id,
                    {
                        "instrument": reagent.instrument,
                        "max_prefix": 0,
                        "count": 0,
                    },
                )
                score["max_prefix"] = max(int(score["max_prefix"]), common_length)
                score["count"] = int(score["count"]) + 1

        if not scores:
            return None

        ranked = sorted(
            scores.values(),
            key=lambda item: (int(item["max_prefix"]), int(item["count"])),
            reverse=True,
        )
        best = ranked[0]
        if len(ranked) > 1 and int(best["max_prefix"]) == int(ranked[1]["max_prefix"]):
            return None
        return best["instrument"]

    def _known_product_family_codes(self, reagent: Reagent) -> set[str]:
        codes = set()
        match_pattern = self._normalize_rule_value(reagent.match_pattern)
        if match_pattern:
            if match_pattern.startswith("01") and len(match_pattern) >= 10:
                codes.add(match_pattern[:16] if len(match_pattern) >= 16 else match_pattern)
            else:
                normalized = self._normalize_product_family_code(match_pattern)
                if normalized:
                    codes.add(normalized)

        raw_product = self._extract_product_code(self._normalize_rule_value(reagent.raw_barcode_sample))
        normalized_raw_product = self._normalize_product_family_code(raw_product)
        if normalized_raw_product:
            codes.add(normalized_raw_product)
        return codes

    def _normalize_product_family_code(self, product_code: str | None) -> str | None:
        cleaned = self._normalize_rule_value(product_code)
        if not cleaned:
            return None
        if cleaned.startswith("01"):
            return cleaned[:16] if len(cleaned) >= 16 else cleaned
        return f"01{cleaned}"[:16]

    def _common_prefix_length(self, left: str, right: str) -> int:
        index = 0
        max_length = min(len(left), len(right))
        while index < max_length and left[index] == right[index]:
            index += 1
        return index

    def _infer_batch_position(
        self,
        barcode: str,
        batch_no: str,
    ) -> tuple[str | None, int | None]:
        anchor = "10"
        best_offset = None
        for anchor_index in self._find_anchor_indices(barcode, anchor):
            search_start = anchor_index + len(anchor)
            relative_index = barcode.find(batch_no, search_start)
            if relative_index < 0:
                continue

            offset = relative_index - search_start
            if best_offset is None or offset < best_offset:
                best_offset = offset

        if best_offset is not None:
            return anchor, best_offset

        absolute_index = barcode.find(batch_no)
        if absolute_index >= 0:
            return None, absolute_index

        return None, None

    def _find_anchor_indices(self, barcode: str, anchor: str) -> list[int]:
        indices: list[int] = []
        start = 0
        while True:
            index = barcode.find(anchor, start)
            if index < 0:
                return indices
            indices.append(index)
            start = index + 1

    def _extract_expiry_date(self, barcode: str) -> Optional[date]:
        for ai_match in re.finditer(r"17(\d{6})", barcode):
            ai_date = self._parse_ai_date(ai_match.group(1))
            if ai_date:
                return ai_date

        patterns = [
            (r"(\d{4})(\d{2})(\d{2})", True),
            (r"(\d{2})(\d{2})(\d{2})", False),
        ]

        for pattern, is_full_year in patterns:
            match = re.search(pattern, barcode)
            if match:
                try:
                    if is_full_year:
                        year = int(match.group(1))
                        month = int(match.group(2))
                        day = int(match.group(3))
                    else:
                        year = 2000 + int(match.group(1))
                        month = int(match.group(2))
                        day = int(match.group(3))

                    if 2020 <= year <= 2050 and 1 <= month <= 12 and 1 <= day <= 31:
                        return date(year, month, day)
                except ValueError:
                    continue

        return None

    def _parse_ai_date(self, value: str) -> Optional[date]:
        if len(value) != 6 or not value.isdigit():
            return None

        try:
            year = 2000 + int(value[:2])
            month = int(value[2:4])
            day = int(value[4:6])
            if 2020 <= year <= 2050 and 1 <= month <= 12 and 1 <= day <= 31:
                return date(year, month, day)
        except ValueError:
            return None

        return None

    def _normalize_rule_value(self, value: str | None) -> str:
        return "".join((value or "").strip().upper().split())

    def _derive_rule_anchor_rank(self, rule: BarcodeBatchRule) -> int | None:
        if not rule.batch_anchor or not rule.raw_barcode_sample or not rule.learned_batch_no:
            return None

        sample_barcode = self._normalize_rule_value(rule.raw_barcode_sample)
        sample_batch = self._normalize_rule_value(rule.learned_batch_no)
        anchor_indices = self._find_anchor_indices(sample_barcode, rule.batch_anchor)
        if not anchor_indices:
            return None

        for index, anchor_index in enumerate(anchor_indices):
            start = anchor_index + len(rule.batch_anchor) + rule.batch_offset
            end = start + rule.batch_length
            if start < 0 or end > len(sample_barcode):
                continue
            if sample_barcode[start:end] == sample_batch:
                return index

        return None

    def _derive_rule_follow_token(self, rule: BarcodeBatchRule) -> str | None:
        if not rule.raw_barcode_sample or not rule.learned_batch_no:
            return None

        sample_barcode = self._normalize_rule_value(rule.raw_barcode_sample)
        sample_batch = self._normalize_rule_value(rule.learned_batch_no)
        sample_start = sample_barcode.find(sample_batch)
        if sample_start < 0:
            return None

        follow_start = sample_start + len(sample_batch)
        follow_token = sample_barcode[follow_start:follow_start + 2]
        return follow_token or None

    def _upsert_batch_rule(
        self,
        instrument_id: int,
        reagent_id: int | None,
        product_code: str | None,
        batch_anchor: str | None,
        batch_offset: int,
        batch_length: int,
        raw_barcode_sample: str,
        learned_batch_no: str,
    ) -> None:
        query = self.db.query(BarcodeBatchRule).filter(
            BarcodeBatchRule.instrument_id == instrument_id,
            BarcodeBatchRule.is_active.is_(True),
        )
        if product_code is None:
            query = query.filter(BarcodeBatchRule.product_code.is_(None))
        else:
            query = query.filter(BarcodeBatchRule.product_code == product_code)

        if reagent_id is None:
            query = query.filter(BarcodeBatchRule.reagent_id.is_(None))
        else:
            query = query.filter(BarcodeBatchRule.reagent_id == reagent_id)

        rule = query.order_by(BarcodeBatchRule.created_at.desc()).first()
        if not rule:
            rule = BarcodeBatchRule(
                instrument_id=instrument_id,
                reagent_id=reagent_id,
                product_code=product_code,
            )
            self.db.add(rule)

        rule.reagent_id = reagent_id
        rule.product_code = product_code
        rule.batch_anchor = batch_anchor
        rule.batch_offset = batch_offset
        rule.batch_length = batch_length
        rule.raw_barcode_sample = raw_barcode_sample
        rule.learned_batch_no = learned_batch_no
        rule.is_active = True
        self.db.flush()

    def _log_parse(self, barcode: str, match_result: str, reagent_id: Optional[int]):
        log = ParseLog(
            raw_barcode=barcode,
            match_result=match_result,
            matched_reagent_id=reagent_id,
        )
        self.db.add(log)
        self.db.commit()
